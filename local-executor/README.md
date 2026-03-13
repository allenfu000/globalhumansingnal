# Local Executor

## Start

```bash
cd local-executor
npm start
```

or double click `run-local-executor.bat`.

## Endpoint

- Health: `GET http://127.0.0.1:47811/health`
- Execute: `POST http://127.0.0.1:47811/api/dev/execute`

## Safety

- Only allows file paths under project root.
- Blocks path traversal to system directories.
- `run_script` is restricted by command allowlist.
