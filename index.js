const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { wrapper } = require('axios-cookiejar-support');
const tough = require('tough-cookie');
const dotenv = require('dotenv').config();

const jar = new tough.CookieJar();
const client = wrapper(axios.create({ jar }));

const app = express();
const port = process.env.PORT || 3000;
const email = process.env.EMAIL;
const senha = process.env.SENHA;

app.use(express.json());

console.clear()

// Função para login
async function login() {
    const options = {
        method: 'POST',
        url: 'https://www.blacktag.com.br/usuarios/login',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        },
        data: `email=${email}&password=${senha}`
    };

    try {
        const response = await client.request(options);
        const html = response.data;
        const $ = cheerio.load(html);

        // Verificar credenciais
        const verificarCredenciais = $('.alert.alert-danger').text().trim();
        if (verificarCredenciais === 'E-mail e/ou senha incorretos.') {
            throw new Error('Credenciais incorretas');
        }

        console.log('[+] Logado com sucesso.');
    } catch (error) {
        console.error('[-] Erro ao realizar login: ' + error.message);
    }
}

// Funçao para verificar se o login ainda esta ativo
async function isLoginActive() {
    try {
        const response = await client.get('https://www.blacktag.com.br/usuarios/meus-dados');
        const html = response.data;
        const $ = cheerio.load(html);

        const isLoggedIn = $('.mx-auto.mb-2.border.rounded-circle.p-1').length > 0;

        return isLoggedIn;
    } catch (error) {
        console.error('[-] Erro ao verificar sessão de login: ' + error.message);
        return false;
    }
}

// Middleware para garantir que o login esteja ativo
async function ensureLoggedIn(req, res, next) {
    const loggedIn = await isLoginActive();
    if (!loggedIn) {
        console.log('[+] Sessão expirada. Realizando login novamente.');
        await login();
    }
    next();
}

// Rota para obter ingressos
app.get('/ingressos', ensureLoggedIn, async (req, res) => {
    try {
        const response = await client.get('https://www.blacktag.com.br/usuarios/meus-ingressos');
        const html = response.data;
        const $ = cheerio.load(html);

        const events = [];
        $('.row.mb-4.mx-auto').each((index, element) => {
            const card = $(element);

            // EVENTOS QUE AINDA NAO OCORRERAM: card bg-light w-100 card-payment
            // EVENTOS QUE JA OCORRERAM: card bg-light w-100 opacity-3

            const eventName = card.find('.modal-title').text().trim();
            const eventDate = card.find('p.mb-1.text-primary').first().find('small').text().trim();
            const eventTime = card.find('p.mb-1.text-primary').eq(1).find('small').text().trim();
            const eventLocation = card.find('p.mb-1.text-secondary').first().find('small').text().trim();
            const eventAddress = card.find('p.mb-1.text-secondary').last().find('small').text().trim();

            const tickets = card.find('.carousel-item').map((i, item) => {
                const carouselItem = $(item);
                let qrCodeUrl = carouselItem.find('.qrcode-image').attr('src').trim();
                qrCodeUrl = `https://blacktag.com.br${qrCodeUrl}`
                const ticketType1 = carouselItem.find('.mb-1.text-info.font-weight-light').text().trim();
                const ticketType2 = carouselItem.find('.mb-0.text-info.font-weight-light').text().trim();

                let ticketType = ""
                if (ticketType1 == "") {
                    ticketType = ticketType2
                } else {
                    ticketType = ticketType1
                }

                const promotionalValue = carouselItem.find('p.mb-1.text-info small').text().trim() || '';
                const ticketId = carouselItem.find('.btn-transfer').attr('data-ticket-id') || '';
                const ticketInfo = carouselItem.find('.row.mt-3 .col p small').text().trim();
                const orderNumberMatch = ticketInfo.match(/Pedido:\s*#(\d+)/);
                const orderNumber = orderNumberMatch ? orderNumberMatch[1] : 'Não disponível';

                if (ticketType != "") {
                    return {
                        qrCodeUrl,
                        ticketType,
                        promotionalValue,
                        ticketId,
                        orderNumber
                    };
                }
            }).get();

            events.push({
                nome: eventName,
                data: eventDate,
                hora: eventTime,
                local: eventLocation,
                endereco: eventAddress,
                tickets
            });
        });

        res.json(events);
    } catch (error) {
        res.status(500).send('Erro ao obter ingressos: ' + error.message);
    }
});

// Rota para checar as informações dos usuarios para poder retornar uma confirmação
app.post('/checkUser', ensureLoggedIn, async (req, res) => {
    const { userEmail } = req.body;

    try {
        const checkUserUrl = 'https://www.blacktag.com.br/transfer-tickets/check-user';
        const response = await client.post(checkUserUrl, `email=${encodeURIComponent(userEmail)}`);
        const contentType = response.headers['content-type'];
        if (contentType.includes('application/json')) {
            const data = response.data;
            res.json(data)
        } else {
            res.status(500).json({ message: 'Tipo de conteúdo inesperado na resposta' });
        }

    } catch (error) {
        console.error('Erro ao verificar usuário:', error.message);
        res.status(500).json({ message: 'Erro inesperado ao verificar usuário' });
    }
});

// Rota para transferencia de ingresso atraves do ID
app.post('/transferir', ensureLoggedIn, async (req, res) => {
    const { ticketId, userId } = req.body;
    try {
        const transferUrl = 'https://www.blacktag.com.br/transfer-tickets/transfer';
        const response = await client.post(transferUrl, {
            ticket_id: ticketId,
            user_id: userId
        });

        if (response.status === 200) {
            res.json({ message: `Ingresso: ${ticketId} Transferido com sucesso para o usuario: ${userId}` });
        } else {
            res.status(response.status).json({ message: 'Erro ao transferir ingresso' });
        }
    } catch (error) {
        if (error.response && error.response.data) {
            const contentType = error.response.headers['content-type'];

            if (contentType.includes('application/json')) {
                // Se a resposta for JSON
                const errorMessage = error.response.data.message || 'Erro inesperado ao transferir ingresso';
                res.status(500).json({ message: errorMessage });
            } else if (contentType.includes('text/html')) {
                // Se a resposta for HTML, vamos usar o Cheerio para extrair a mensagem
                const $ = cheerio.load(error.response.data);
                let errorMessage = $('p.error').text().trim() || 'Erro inesperado ao transferir ingresso';

                // Remover o "Error:" seguido por qualquer quebra de linha e espaços
                errorMessage = errorMessage.replace(/^Error:\s*\n\s*/, '');

                res.status(500).json({ message: errorMessage });
            } else {
                res.status(500).json({ message: 'Erro inesperado ao transferir ingresso' });
            }
        } else {
            console.error('Erro ao transferir ingresso:', error.message);
            res.status(500).json({ message: 'Erro inesperado ao transferir ingresso' });
        }
    }
});

// Rota para transferencia de ingresso através do e-mail
app.post('/transferticket', ensureLoggedIn, async (req, res) => {
    const { ticketId, userEmail } = req.body;

    if (ticketId == null || userEmail == null || ticketId == "" || userEmail == "")
        return res.json({ message: 'o ticketId e/ou userEmail não pode ser nulo' })
    try {
        const checkUserInfoUrl = 'https://www.blacktag.com.br/transfer-tickets/check-user'
        const response = await client.post(checkUserInfoUrl, `email=${encodeURIComponent(userEmail)}`)
        const contentType = response.headers['content-type'];
        if (contentType.includes('application/json')) {
            const data = response.data;
            const userId = data.result.id;

            if (userId) {
                try {
                    const transferUrl = 'https://www.blacktag.com.br/transfer-tickets/transfer';
                    const response = await client.post(transferUrl, {
                        ticket_id: ticketId,
                        user_id: userId
                    });

                    if (response.status === 200) {
                        res.json({ message: `Ingresso: ${ticketId} Transferido com sucesso para o usuario: ${userId}` });
                    } else {
                        res.status(response.status).json({ message: 'Erro ao transferir ingresso' });
                    }
                } catch (error) {
                    if (error.response && error.response.data) {
                        const contentType = error.response.headers['content-type'];

                        if (contentType.includes('application/json')) {
                            // Se a resposta for JSON
                            const errorMessage = error.response.data.message || 'Erro inesperado ao transferir ingresso';
                            res.status(500).json({ message: errorMessage });
                        } else if (contentType.includes('text/html')) {
                            // Se a resposta for HTML, vamos usar o Cheerio para extrair a mensagem
                            const $ = cheerio.load(error.response.data);
                            let errorMessage = $('p.error').text().trim() || 'Erro inesperado ao transferir ingresso';

                            // Remover o "Error:" seguido por qualquer quebra de linha e espaços
                            errorMessage = errorMessage.replace(/^Error:\s*\n\s*/, '');

                            res.status(500).json({ message: errorMessage });
                        } else {
                            res.status(500).json({ message: 'Erro inesperado ao transferir ingresso' });
                        }
                    } else {
                        console.error('Erro ao transferir ingresso:', error.message);
                        res.status(500).json({ message: 'Erro inesperado ao transferir ingresso' });
                    }
                }
            } else {
                res.status(400).json({ message: 'Usuário não encontrado ou resposta inválida' });
            }
        } else {
            res.status(500).json({ message: 'Tipo de conteúdo inesperado na resposta' });
        }
    } catch (error) {
        console.error('Erro ao verificar usuário:', error.message);
        res.status(500).json({ message: 'Erro inesperado ao verificar usuário' });
    }
})

// Inicializar o servidor
login().then(() => {
    app.listen(port, () => {
        console.log(`Servidor rodando na porta http://localhost:${port}/`);
    });
}).catch(error => {
    console.error('Erro ao iniciar o servidor: ' + error.message);
});
