"""ByteTrack IDs are local to one recording; never use them as cross-camera IDs."""
import numpy as np
import supervision as sv


def track_people(frames, fps):
    tracker = sv.ByteTrack(track_activation_threshold=.35, lost_track_buffer=30,
                           minimum_matching_threshold=.8, frame_rate=max(1, round(fps)))
    tracks = {}
    previous = -1
    for frame in frames:
        index = int(frame['frame_index'])
        if index <= previous:
            raise ValueError('Detection frames are not in chronological order')
        for _ in range(min(index - previous - 1, 120)):
            tracker.update_with_detections(sv.Detections.empty())
        previous = index
        people = [d for d in frame.get('detections', [])
                  if d.get('label') == 'person' and float(d.get('confidence', 0)) >= .1
                  and len(d.get('bbox', [])) == 4
                  and d['bbox'][2] > d['bbox'][0] and d['bbox'][3] > d['bbox'][1]]
        detections = (sv.Detections(
            xyxy=np.array([d['bbox'] for d in people], dtype=np.float32),
            confidence=np.array([d['confidence'] for d in people], dtype=np.float32),
            class_id=np.zeros(len(people), dtype=int),
        ) if people else sv.Detections.empty())
        tracked = tracker.update_with_detections(detections)
        for i, track_id in enumerate(tracked.tracker_id if tracked.tracker_id is not None else []):
            item = tracks.setdefault(int(track_id), {'track_id': int(track_id), 'samples': []})
            item['samples'].append({'frame': index, 'time': index / fps,
                                    'bbox': tracked.xyxy[i].tolist(),
                                    'confidence': float(tracked.confidence[i])})
    result = []
    for item in tracks.values():
        samples = item['samples']
        span = samples[-1]['frame'] - samples[0]['frame'] + 1
        item.update(start=samples[0]['time'], end=(samples[-1]['frame'] + 1) / fps,
                    coverage=len(samples) / span,
                    mean_confidence=sum(s['confidence'] for s in samples) / len(samples))
        result.append(item)
    return sorted(result, key=lambda t: (-len(t['samples']), t['track_id']))
