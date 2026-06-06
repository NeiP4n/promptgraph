---
name: audit-npm-deps
description: Audit npm dependencies for vulnerabilities and outdated packages
---

# Audit NPM Dependencies

Run a comprehensive audit of project dependencies to find security issues and outdated packages.

## Steps

1. Run npm audit to check for known vulnerabilities:
   ```
   npm audit
   ```
2. Review the severity and impact of each finding.
3. Update individual packages:
   ```
   npm update <package-name>
   ```
4. For critical vulnerabilities with no patch, consider alternatives.
5. Run a full re-audit after updates:
   ```
   npm audit --audit-level=high
   ```

## Usage

Use this before a release or when a security advisory mentions your stack.

```bash
npm audit; npm outdated
```
