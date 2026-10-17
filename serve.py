"""Run with .venv/bin/python serve.py; available only through a local SSH tunnel."""
if __name__ == '__main__':
    import uvicorn
    uvicorn.run('warehouse.app:create_app', factory=True, host='127.0.0.1', port=8765, access_log=False)
