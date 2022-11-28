const net = require('net')

const server = net.createServer({ allowHalfOpen: true }, function (socket) {
  console.log(Date.now(), '5) new connection')

  socket.on('data', () => console.log(Date.now(), '7) on socket data'))
  socket.on('end', () => socket.end())
  socket.on('end', () => console.log(Date.now(), '10) on socket ended'))
  socket.on('close', () => console.log(Date.now(), 'on socket closed'))
  socket.on('error', console.error)

  socket.write('hi from server')
  socket.end()
})

server.listen(3000)
