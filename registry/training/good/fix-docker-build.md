---
name: fix-docker-build
description: Debug and fix common Docker build failures
---

# Fix Docker Build

Debug Docker build failures by inspecting cache, layer order, and dependency issues.

## Steps

1. Check the error message at the failing layer:
   ```
   docker build --no-cache . 2>&1
   ```
2. Run a shell in the failing intermediate container:
   ```
   docker run --rm -it <image> sh
   ```
3. Verify dependency installation order in Dockerfile.
4. Check for missing packages or incorrect package sources.
5. Rebuild with verbose output:
   ```
   DOCKER_BUILDKIT=1 docker build --progress=plain .
   ```

## Usage

Run this when Docker build exits with a non-zero code or fails on a specific layer.

```bash
docker build --no-cache --progress=plain .
```
