# WHOOP server implementation

Server-only WHOOP v2 OAuth, API client, response mapping, rotating token handling, authenticated token encryption, and in-memory cache code. This directory is imported only by `apps/api/`; never bundle it into the browser. Secrets and runtime data are supplied by the host and are not stored here.
