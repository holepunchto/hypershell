const http = require('http')

const server = http.createServer((req, res) => {
  res.end('Hello world! ' + Math.random())
})

server.on('connection', function (socket) {
  console.log('new connection')

  socket.on('data', console.log)
  // socket.on('end', () => socket.end())
  socket.on('end', () => console.log(Date.now(), 'socket ended'))
  socket.on('close', () => console.log(Date.now(), 'socket closed'))
  socket.on('error', console.error)
})

server.listen(3000)
