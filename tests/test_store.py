import tempfile
import unittest
from pathlib import Path
from warehouse.store import Store


class StoreTests(unittest.TestCase):
    def test_publishes_only_complete_replacement_clip_sets(self):
        with tempfile.TemporaryDirectory() as directory:
            store=Store(Path(directory)/'db')
            store.put('recordings',{'id':'r','status':'ready','window_seconds':5})
            store.put('clips',{'id':'old','recording_id':'r','active':True})
            store.put('clips',{'id':'new','recording_id':'r','active':False})
            with self.assertRaises(ValueError):
                store.publish_windows('r',['missing'],2)
            self.assertTrue(store.get('clips','old')['active'])
            store.publish_windows('r',['new'],2)
            self.assertFalse(store.get('clips','old')['active'])
            self.assertTrue(store.get('clips','new')['active'])
            self.assertEqual(store.get('recordings','r')['window_seconds'],2)

    def test_persists_vectors_and_marks_interrupted_jobs_failed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'test.sqlite'
            first = Store(path)
            first.put('clips', {'id': 'c', 'vector': [1.] * 256})
            first.put('recordings', {'id': 'r', 'status': 'processing'})
            first.put('jobs', {'id': 'j', 'status': 'running', 'stage': 'embedding', 'recording_id': 'r'})
            second = Store(path)
            second.recover_jobs()
            self.assertEqual(second.get('clips', 'c')['vector'], [1.] * 256)
            self.assertEqual(second.get('jobs', 'j')['status'], 'failed')
            self.assertIn('interrupted', second.get('jobs', 'j')['error'].lower())
            self.assertEqual(second.get('recordings', 'r')['status'], 'failed')

    def test_update_preserves_unmodified_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / 'db')
            store.put('tracks', {'id': 't', 'identity_confirmed': False, 'samples': [1, 2]})
            store.update('tracks', 't', identity_confirmed=True)
            self.assertEqual(store.get('tracks', 't')['samples'], [1, 2])
            self.assertTrue(store.get('tracks', 't')['identity_confirmed'])
