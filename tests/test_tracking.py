import unittest
from warehouse.tracking import track_people


class TrackingTests(unittest.TestCase):
    def test_preserves_separate_tracks_across_one_missing_frame(self):
        frames = []
        for i in range(30):
            detections = [{'label': 'forklift', 'confidence': .99, 'bbox': [80, 10, 110, 70]}]
            if i != 15:
                detections.append({'label': 'person', 'confidence': .95, 'bbox': [10+i/4, 20, 40+i/4, 90]})
            detections.append({'label': 'person', 'confidence': .92, 'bbox': [140-i/4, 20, 170-i/4, 90]})
            frames.append({'frame_index': i, 'shape': [120, 200], 'detections': detections})
        tracks = track_people(frames, fps=30)
        self.assertEqual(len(tracks), 2)
        self.assertEqual(sorted(len(t['samples']) for t in tracks), [29, 30])
        self.assertTrue(all(len({s['frame'] for s in t['samples']}) == len(t['samples']) for t in tracks))
        self.assertTrue(all(t['coverage'] > .9 for t in tracks))

    def test_no_people_produces_no_tracks(self):
        self.assertEqual(track_people([{'frame_index': 0, 'shape': [100, 100], 'detections': []}], fps=30), [])
