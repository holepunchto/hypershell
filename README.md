# hypershell

CLI to create and connect to remote shells.

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
  --firewall <filename>  Firewall file with a list of public keys allowed to connect. (default: "~/.hypershell/authorized_peers")
```

```shell
Usage: hypershell [options] <server public key>

Connect to a P2P shell.

Options:
  -f <filename>      Filename of the client seed key. (default: "~/.hypershell/peer")
  --allowance [token]  Create or use a temporary one time password to connect to the server.
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
