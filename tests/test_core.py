import unittest
from warehouse.core import normalized_vector, retrieve, crop_bounds, parse_report


def vector(x, y=0):
    return [x, y] + [0.0] * 254


class RetrievalTests(unittest.TestCase):
    def test_returns_several_prior_windows_and_excludes_archived_windows(self):
        query = dict(id='q', worker_id='a', task='walking', recording_id='r', track_id=1,
                     identity_confirmed=False, started_at=8, ended_at=10, vector=vector(1))
        candidates = [dict(query, id=str(i), started_at=i*2, ended_at=(i+1)*2) for i in range(4)]
        candidates.append(dict(query, id='archived', started_at=0, ended_at=2, active=False))
        self.assertEqual([r['id'] for r in retrieve(query, candidates)], ['3', '2', '1', '0'])

    def test_excludes_other_workers_tasks_future_and_unconfirmed_cross_recording(self):
        query = dict(id='q', worker_id='a', task='lifting', recording_id='r2',
                     identity_confirmed=True, started_at=100, ended_at=105, vector=vector(1))
        base = dict(worker_id='a', task='lifting', recording_id='r1', identity_confirmed=True,
                    started_at=10, ended_at=15, vector=vector(.8, .6))
        candidates = [dict(base, id='ok'), dict(base, id='other-worker', worker_id='b'),
                      dict(base, id='other-task', task='walking'),
                      dict(base, id='future', started_at=110, ended_at=115),
                      dict(base, id='overlap', started_at=99, ended_at=101),
                      dict(base, id='unconfirmed', identity_confirmed=False), query]
        ranked = retrieve(query, candidates)
        self.assertEqual([c['id'] for c in ranked], ['ok'])
        self.assertAlmostEqual(ranked[0]['similarity'], .8)

    def test_unconfirmed_identity_can_only_compare_same_continuous_track(self):
        query = dict(id='q', worker_id=None, task='warehouse', recording_id='r', track_id=3,
                     identity_confirmed=False, started_at=5, ended_at=10, vector=vector(1))
        earlier = dict(query, id='earlier', started_at=0, ended_at=5)
        self.assertEqual([r['id'] for r in retrieve(query, [earlier, dict(earlier, id='wrong', track_id=4)])], ['earlier'])
        self.assertEqual(retrieve(query, [dict(earlier, recording_id='other')]), [])

    def test_invalid_and_zero_vectors_are_rejected(self):
        for invalid in ([0.] * 256, [1., 2.], vector(float('nan')), vector(float('inf'))):
            with self.assertRaises(ValueError):
                normalized_vector(invalid)

    def test_demo_without_capture_date_cannot_become_cross_recording_history(self):
        query = dict(id='q', worker_id='a', task='lifting', recording_id='real',
                     identity_confirmed=True, started_at=100, ended_at=105, vector=vector(1), demo=False)
        demo = dict(query, id='demo', recording_id='simulated', started_at=0, ended_at=5, demo=True)
        self.assertEqual(retrieve(query, [demo]), [])


class MediaTests(unittest.TestCase):
    def test_crop_is_even_and_clamped_to_frame(self):
        self.assertEqual(crop_bounds([[-20, -10, 101, 99]], 100, 98, padding=0), (0, 0, 100, 98))
        with self.assertRaises(ValueError):
            crop_bounds([], 100, 98)


class ReportTests(unittest.TestCase):
    def test_accepts_fenced_json_but_rejects_unstructured_or_unsupported_decisions(self):
        good = '{"observable_changes":["Walks toward the forklift"],"task_context":"Same scene", "limitations":["Short clip"],"human_review_summary":"Review context", "review_priority":"routine"}'
        self.assertEqual(parse_report('```json\n' + good + '\n```')['review_priority'], 'routine')
        for bad in ('fatigued worker', '{}', good.replace('routine', 'diagnosed')):
            with self.assertRaises(ValueError):
                parse_report(bad)


if __name__ == '__main__':
    unittest.main()
