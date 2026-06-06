---
name: scan-network
description: Scan a local network for active hosts and open ports
---

# Scan Network

Run a quick network scan to discover active hosts and open ports on the local subnet.

## Steps

1. Identify your subnet using `ipconfig` or `ifconfig`.
2. Run a ping sweep to find live hosts:
   ```
   nmap -sn 192.168.1.0/24
   ```
3. Scan open ports on discovered hosts:
   ```
   nmap -sS -p 1-1000 192.168.1.1-254
   ```
4. Identify services by banner grabbing:
   ```
   nmap -sV 192.168.1.1
   ```

## Usage

Use this when you need to find devices on a network or check which services are exposed.

```bash
nmap -sn 192.168.1.0/24
```
