import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS items (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id))')

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=20)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def put(self, kind, item):
        with self.lock, self.connect() as db:
            db.execute('INSERT OR REPLACE INTO items VALUES(?,?,?)', (kind, item['id'], json.dumps(item, allow_nan=False)))
        return item

    def get(self, kind, identifier):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM items WHERE kind=? AND id=?', (kind, identifier)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self, kind):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute('SELECT payload FROM items WHERE kind=? ORDER BY rowid', (kind,))]

    def update(self, kind, identifier, **changes):
        with self.lock:
            item = self.get(kind, identifier)
            if item is None:
                raise KeyError(identifier)
            return self.put(kind, dict(item, **changes))

    def recover_jobs(self):
        for job in self.all('jobs'):
            if job['status'] in ('running', 'queued'):
                self.update('jobs', job['id'], status='failed', finished_at=time.time(),
                            error='Processing was interrupted by a server restart. Start a new job to retry.')
        for recording in self.all('recordings'):
            if recording.get('status') == 'processing':
                self.update('recordings', recording['id'], status='failed')

    def publish_windows(self, recording_id, clip_ids, window_seconds):
        """Publish one complete replacement index in a single SQLite transaction."""
        with self.lock, self.connect() as db:
            rows = db.execute('SELECT id,payload FROM items WHERE kind=?', ('clips',)).fetchall()
            relevant = [(identifier,json.loads(payload)) for identifier,payload in rows
                        if json.loads(payload).get('recording_id') == recording_id]
            if not set(clip_ids).issubset({identifier for identifier,_ in relevant}):
                raise ValueError('Replacement clips are incomplete')
            for identifier,clip in relevant:
                clip['active'] = identifier in clip_ids
                db.execute('UPDATE items SET payload=? WHERE kind=? AND id=?', (json.dumps(clip), 'clips', identifier))
            row = db.execute('SELECT payload FROM items WHERE kind=? AND id=?', ('recordings',recording_id)).fetchone()
            recording = json.loads(row[0])
            recording.update(status='ready',window_seconds=window_seconds)
            db.execute('UPDATE items SET payload=? WHERE kind=? AND id=?', (json.dumps(recording),'recordings',recording_id))
