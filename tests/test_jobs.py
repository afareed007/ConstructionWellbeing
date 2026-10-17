import tempfile
import time
import unittest
from pathlib import Path
from warehouse.store import Store
from warehouse.pipeline import Pipeline, BusyError
from warehouse.services import ServiceError


class UnavailableServices:
    def sample(self, destination):
        raise ServiceError('Video library is unavailable or timed out.')


class JobTests(unittest.TestCase):
    def test_reasoner_failure_during_expansion_keeps_original_view_published(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            store=Store(root/'db')
            class FailedReasoner(UnavailableServices):
                def reason(self,*args):
                    raise ServiceError('Reasoner unavailable')
            pipeline=Pipeline(root,store,FailedReasoner())
            store.put('recordings',{'id':'r','demo':True,'status':'ready','window_seconds':5})
            store.put('tracks',{'id':'r-1','recording_id':'r','track_id':1})
            store.put('clips',{'id':'old','recording_id':'r','active':True})
            def indexed(*args,**kwargs):
                clips=[]
                for i in range(2):
                    clips.append(store.put('clips',dict(id=str(i),recording_id='r',track_id=1,track_key='r-1',
                        active=False,worker_id=None,identity_confirmed=False,task='walking',
                        started_at=i*2,ended_at=(i+1)*2,duration=2,demo=True,
                        media_path=f'{i}.mp4',context_path=f'{i}-context.mp4',vector=[1.]+[0.]*255)))
                return clips
            pipeline.index_windows=indexed
            with patch('warehouse.pipeline.media.comparison'):
                job=pipeline.submit_sample()
                pipeline.executor.shutdown(wait=True)
            self.assertEqual(store.get('jobs',job['id'])['status'],'failed')
            self.assertTrue(store.get('clips','old')['active'])
            self.assertFalse(store.get('clips','0')['active'])
            self.assertEqual(store.get('recordings','r')['status'],'ready')

    def test_failed_demo_expansion_preserves_existing_clips(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            store=Store(root/'db')
            pipeline=Pipeline(root,store,UnavailableServices())
            store.put('recordings',{'id':'r','demo':True,'status':'ready','media_path':'r/normalized.mp4'})
            store.put('tracks',{'id':'r-1','recording_id':'r','track_id':1})
            store.put('clips',{'id':'old','recording_id':'r','active':True})
            def unavailable(*args,**kwargs):
                raise ServiceError('Embedding unavailable')
            pipeline.index_windows=unavailable
            job=pipeline.submit_sample()
            pipeline.executor.shutdown(wait=True)
            self.assertEqual(store.get('jobs',job['id'])['status'],'failed')
            self.assertTrue(store.get('clips','old')['active'])

    def test_unchanged_identity_confirmation_preserves_other_same_worker_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'db')
            pipeline = Pipeline(root, store, UnavailableServices())
            store.put('tracks', {'id': 'a', 'worker_id': 'worker-1', 'identity_confirmed': True, 'task': 'lifting'})
            store.put('analyses', {'id': 'report', 'track_key': 'b', 'worker_id': 'worker-1', 'status': 'complete'})
            pipeline.confirm_identity('a', 'worker-1', 'lifting')
            self.assertEqual(store.get('analyses', 'report')['status'], 'complete')
            pipeline.executor.shutdown(wait=True)

    def test_changing_reference_identity_invalidates_dependent_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'db')
            pipeline = Pipeline(root, store, UnavailableServices())
            store.put('tracks', {'id': 't', 'worker_id': 'a', 'task': 'lifting'})
            store.put('clips', {'id': 'reference', 'track_key': 't', 'worker_id': 'a'})
            store.put('analyses', {'id': 'report', 'clip_id': 'query', 'track_key': 'other',
                                   'reference_id': 'reference', 'status': 'complete', 'worker_id': 'a'})
            pipeline.confirm_identity('t', 'b', 'lifting')
            self.assertEqual(store.get('analyses', 'report')['status'], 'stale')
            pipeline.executor.shutdown(wait=True)

    def test_failed_import_is_failed_not_successful_and_does_not_create_analysis(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'db')
            pipeline = Pipeline(root, store, UnavailableServices())
            job = pipeline.submit_sample()
            pipeline.executor.shutdown(wait=True)
            saved = store.get('jobs', job['id'])
            self.assertEqual(saved['status'], 'failed')
            self.assertEqual(saved['error'], 'Video library is unavailable or timed out.')
            self.assertEqual(store.all('analyses'), [])

    def test_does_not_accept_overlapping_jobs(self):
        import threading
        entered, release = threading.Event(), threading.Event()
        class SlowServices:
            def sample(self, destination):
                entered.set()
                release.wait(3)
                raise ServiceError('Test unavailable')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pipeline = Pipeline(root, Store(root / 'db'), SlowServices())
            pipeline.submit_sample()
            self.assertTrue(entered.wait(2))
            try:
                with self.assertRaises(BusyError):
                    pipeline.submit_sample()
            finally:
                release.set()
                pipeline.executor.shutdown(wait=True)
