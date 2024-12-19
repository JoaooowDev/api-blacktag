const WebSocket = require('ws');

// Cria um servidor WebSocket na porta 8080
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('Cliente conectado.');

  // Envia uma mensagem para o cliente quando ele se conecta
  ws.send('Bem-vindo ao nosso chat de atendimento!');

  // Quando o servidor recebe uma mensagem do cliente
  ws.on('message', (message) => {
    console.log(`Mensagem recebida do cliente: ${message}`);
    
    // Envia de volta a mensagem recebida para o cliente
    ws.send(`Você disse: ${message}`);
  });

  // Quando o cliente se desconecta
  ws.on('close', () => {
    console.log('Cliente desconectado.');
  });
});

console.log('Servidor WebSocket rodando na porta 8080.');
