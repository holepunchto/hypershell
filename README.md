# hypershell

Spawn shells anywhere. Fully peer-to-peer, authenticated, and end to end encrypted.

## Install
```
npm i -g hypershell
```

## Usage
```shell
# Create keys
hypershell-keygen [-f keyfile] [-c comment]

# Create a P2P shell server
hypershell-server [-f keyfile] [--firewall filename]

# Connect to a P2P shell
hypershell [-f keyfile] <server name or public key>

# Tunnel proxy that forwards to remote host
hypershell [-L [address:]port:host:hostport] <server name or public key>

# Copy files (download and upload)
hypershell-copy [-f keyfile] <[@host:]source> <[@host:]target>
```

Use `--help` with any command for more information, for example `hypershell-server --help`.

## First steps
Keys are automatically created with a default filename on first run.

Otherwise, you can first do:
```bash
hypershell-keygen
```

Just connect to servers (they have to allow your public key):
```bash
hypershell <server name or public key>
```

You could also create a server:
```bash
hypershell-server
```

`~/.hypershell/authorized_peers` file will be empty, denying all connections by default.\
Public keys can be added to the list to allow them in real-time.

## Known peers
There will be a file `~/.hypershell/known_peers`.

Add named peers to the file like for example:
```bash
# <name> <public key>
home cdb7b7774c3d90547ce2038b51367dc4c96c42abf7c2e794bb5eb036ec7793cd 
```

Now just `hypershell home` (it saves you writing the entire public key).

## hypershell-copy
Similar to `scp`. It works with files, and with folders recursively.

For the next examples, `remote_peer` is a name that can be added to the `known_peers` file.

Upload a file from your desktop to a remote server:
```bash
hypershell-copy ~/Desktop/file.txt @remote_peer:/root/file.txt
```

Download a file from a remote server to your desktop:
```bash
hypershell-copy @remote_peer:/root/database.json ~/Desktop/db-backup.json
```

Note: in the future, the `@` might be removed.

You can also use the public key of the server directly (without `@`):
```bash
hypershell-copy ~/Desktop/some-folder cdb7b7774c3d90547ce2038b51367dc4c96c42abf7c2e794bb5eb036ec7793cd:/root/backup-folder
```

## Tunnel proxy

#### Client

It creates a local server, and every connection is forwarded to the remote host.

In this example, creates a local tunnel at `127.0.0.1:2020` (where you can connect to),\
that later gets forwarded to a remote server which it connects to `127.0.0.1:3000`:
```bash
hypershell remote_peer -L 127.0.0.1:2020:127.0.0.1:3000
```

Instead of `remote_peer` you can use the server public key as well.

You can also pass several `-L` to run multiple local servers that remote forwards:
```bash
hypershell remote_peer -L 2020:127.0.0.1:3000 -L 2021:127.0.0.1:3000 -L 2022:127.0.0.1:3000
```

#### Server

By default, `hypershell-server` runs a server with full access, including forwarding to all hosts and ports.

You can run a server with restricted permissions to allow forwarding a specific host and port only.

Let's say you have a local project like a React app at `http://127.0.0.1:3000/`,\
you can create a restricted server to safely share this unique port like so:

```bash
hypershell-server --protocol tunnel --tunnel-host 127.0.0.1 --tunnel-port 3000
```

Or if you want to allow multiple hosts, port range, etc:

```bash
hypershell-server --protocol tunnel  --tunnel-host 127.0.0.1 --tunnel-host 192.168.0.25 --tunnel-port 1080 --tunnel-port 3000 --tunnel-port 4100-4200
```

Clients trying to use any different hosts/ports are automatically disconnected.

## Multiple keys
To have multiple servers, you need multiple keys.

Generate another key:
```bash
hypershell-keygen -f ~/.hypershell/my-server
```

Now create a new shell server:
```bash
hypershell-server -f ~/.hypershell/my-server --firewall ~/.hypershell/my-server-firewall
```

The client also accepts `-f` in case you need it.

## Disable server protocols

This is the list of server protocols:
- `shell`
- `upload`
- `download`
- `tunnel`

By default, all of them are enabled when running a server.

For example, you could limit it to shell only:\
`hypershell-server --protocol shell`

Or only allow file upload and/or download:\
`hypershell-server --protocol upload --protocol download`

Restrict to tunnel only:\
`hypershell-server --protocol tunnel`

For example, if you only allow `tunnel`, then any attempt from clients to `shell` into the server will auto disconnect them.

## License
MIT
