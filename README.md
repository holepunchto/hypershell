# hypershell

CLI to create and connect to P2P E2E encrypted shells.

## Install
```
npm i -g hypershell
```

## Usage
```shell
Usage: hypershell-server [options]

Create a P2P shell server.

Options:
  -f <filename>          Filename of the server seed key. (default: "~/.hypershell/peer")
  --firewall <filename>  List of allowed public keys. (default: "~/.hypershell/authorized_peers")
```

```shell
Usage: hypershell [options] <server public key>

Connect to a P2P shell.

Options:
  -f <filename>      Filename of the client seed key. (default: "~/.hypershell/peer")
```

```shell
Usage: hypershell-keygen [options]

Create keys of type ed25519 for use by hypercore-protocol.

Options:
  -f <filename>  Filename of the seed key file.
  -c <comment>   Provides a new comment.
```

## Setup
First, create a key with the default filename:
```bash
hypershell-keygen
```

#### Client
Now you can connect to servers (they have to allow your public key):
```bash
hypershell <server public key>
```

#### Server
If you wanted to, you can also create a server:
```bash
hypershell-server
```

`~/.hypershell/firewall` will be automatically created as an empty file.\
That means, all connections are denied by default.

You can allow public keys in real-time by adding them to the firewall list.

## Known peers
There will be a file `~/.hypershell/known_peers`.

Add named peers to the file like this:
```bash
# <name> <public key>
home cdb7b7774c3d90547ce2038b51367dc4c96c42abf7c2e794bb5eb036ec7793cd 
```

Now just `hypershell home` and no more always writing the entire public key.

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

## License
MIT
