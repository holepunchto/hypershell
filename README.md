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
  -f <filename>          Specifies the filename of the server key. (default: "~/.hypershell/peer")
  --firewall <filename>  Firewall file with a list of public keys allowed to connect. (default: "~/.hypershell/firewall")
```

```shell
Usage: hypershell [options] <server public key>

Connect to a P2P shell.

Options:
  -f <filename>      Specifies the filename of the client key. (default: "~/.hypershell/peer")
```

```shell
Usage: hypershell-keygen [options]

Create keys of type ed25519 for use by hypercore-protocol.

Options:
  -f <filename>  Specifies the filename of the key file.
  -c <comment>   Provides a new comment.
```

## Client setup
First, create a key with the default filename:
```bash
hypershell-keygen
```

Now you could connect to servers (they have to allow your public key):
```bash
hypershell <server public key>
```

## Server setup
First do a `hypershell-keygen` with the default filename as per client setup.

```bash
hypershell-server
```

`~/.hypershell/firewall` will be automatically created as an empty file.\
That means, by default all connections are denied.

You can allow public keys in real-time by adding them to the firewall list.

## Multiple servers
You could create another key if you want multiple servers:
```bash
hypershell-keygen -f ~/.hypershell/my-server
```

Now create a new shell server:
```bash
hypershell-server -f ~/.hypershell/my-server
```

## License
MIT
