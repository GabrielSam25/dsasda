const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configuração do cliente Discord
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// TOKEN DO BOT DISCORD - COLE SEU TOKEN AQUI
const DISCORD_BOT_TOKEN = 'MTQxNzUzNTMyNjM3Mjc2MTY0NA.Gq4DqM.bCwR_DcuBcdIXXu4J_oC28qIMBtRkODZEiP7wU';

// URL da sua API no Vercel
const API_BASE_URL = 'https://recebasddsa.vercel.app/api/shopee-tracker';

// Carregar dados salvos
const DATA_FILE = path.join(__dirname, 'tracking_data.json');
let trackingData = {};

// Inicializar dados do arquivo se existir
if (fs.existsSync(DATA_FILE)) {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        trackingData = JSON.parse(data);
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
    }
}

// Função para salvar dados
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(trackingData, null, 2));
    } catch (error) {
        console.error('Erro ao salvar dados:', error);
    }
}

// Função para formatar data e hora
function formatDateTime(dateTimeStr) {
    if (!dateTimeStr) return 'Data não disponível';
    
    // Tenta parsear diferentes formatos de data
    const date = new Date(dateTimeStr);
    if (!isNaN(date.getTime())) {
        return date.toLocaleString('pt-BR');
    }
    
    // Se for no formato do site (ex: "13 Sep 2025\n17:41:16")
    if (dateTimeStr.includes('\n')) {
        const [datePart, timePart] = dateTimeStr.split('\n');
        return `${datePart} ${timePart}`;
    }
    
    return dateTimeStr;
}

// Função para obter informações de rastreamento da SUA API
async function getTrackingInfo(trackingCode) {
    try {
        // Usar sua API do Vercel em vez do web scraping direto
        const apiUrl = `${API_BASE_URL}/${trackingCode}`;
        console.log(`📡 Chamando API: ${apiUrl}`);
        
        const response = await axios.get(apiUrl, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const apiData = response.data;
        
        if (!apiData.success) {
            throw new Error(apiData.error || 'Erro na API de rastreamento');
        }

        // Mapear os dados da API para o formato do bot
        const events = apiData.tracking.events.map(event => ({
            time: `${event.date} ${event.time}`,
            message: event.description,
            timestamp: event.timestamp || new Date(`${event.date} ${event.time}`).getTime()
        }));

        // Determinar status atual e emoji correspondente (baseado na API)
        let status = apiData.tracking.status || 'Em processamento';
        let statusEmoji = '⏳';
        
        const statusLower = status.toLowerCase();
        if (statusLower.includes('entregue') || statusLower.includes('delivered')) {
            statusEmoji = '✅';
        } else if (statusLower.includes('saiu para entrega') || statusLower.includes('out for delivery')) {
            statusEmoji = '🚚';
        } else if (statusLower.includes('trânsito') || statusLower.includes('transit')) {
            statusEmoji = '📦';
        } else if (statusLower.includes('postado') || statusLower.includes('posted')) {
            statusEmoji = '📮';
        }

        // Calcular progresso baseado no status
        let progress = 0;
        if (statusLower.includes('entregue')) progress = 100;
        else if (statusLower.includes('saiu para entrega')) progress = 80;
        else if (statusLower.includes('trânsito')) progress = 60;
        else if (statusLower.includes('postado')) progress = 40;
        else progress = 20;

        return {
            success: true,
            trackingCode,
            status: `${statusEmoji} ${status}`,
            statusEmoji,
            progress,
            events,
            lastUpdated: new Date().toISOString(),
            estimatedDelivery: calculateEstimatedDelivery(events),
            rawData: apiData // Manter dados brutos para debug
        };
    } catch (error) {
        console.error('Erro ao buscar informações da API:', error);
        
        // Fallback: tentar web scraping direto se a API falhar
        if (error.response?.status === 404) {
            throw new Error('API de rastreamento não encontrada. Verifique a URL.');
        }
        
        throw new Error(`Erro na API: ${error.message}`);
    }
}

// Função para fallback (web scraping direto)
async function getTrackingInfoFallback(trackingCode) {
    try {
        console.log('🔄 Tentando fallback para web scraping direto...');
        const url = `https://spx.com.br/track?${trackingCode}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const html = response.data;
        const $ = cheerio.load(html);
        
        const events = [];
        $('.nss-comp-tracking-item').each((index, element) => {
            const time = $(element).find('.time').text().trim();
            const message = $(element).find('.message').text().trim();
            events.push({ 
                time: formatDateTime(time), 
                message,
                timestamp: new Date().getTime()
            });
        });
        
        // Determinar status atual e emoji correspondente
        let status = 'Em processamento';
        let statusEmoji = '⏳';
        const lastUpdate = events[0]?.message.toLowerCase() || '';
        
        if (lastUpdate.includes('entregue') || lastUpdate.includes('delivered')) {
            status = 'Entregue';
            statusEmoji = '✅';
        } else if (lastUpdate.includes('saiu para entrega') || lastUpdate.includes('out for delivery')) {
            status = 'Saiu para entrega';
            statusEmoji = '🚚';
        } else if (lastUpdate.includes('trânsito') || lastUpdate.includes('transit')) {
            status = 'Em trânsito';
            statusEmoji = '📦';
        } else if (lastUpdate.includes('postado') || lastUpdate.includes('posted')) {
            status = 'Postado';
            statusEmoji = '📮';
        } else if (lastUpdate.includes('processamento') || lastUpdate.includes('processing')) {
            status = 'Em processamento';
            statusEmoji = '⚙️';
        }
        
        // Calcular progresso (0 a 100)
        let progress = 0;
        if (status === 'Entregue') progress = 100;
        else if (status === 'Saiu para entrega') progress = 80;
        else if (status === 'Em trânsito') progress = 60;
        else if (status === 'Postado') progress = 40;
        else if (status === 'Em processamento') progress = 20;
        
        return {
            success: true,
            trackingCode,
            status: `${statusEmoji} ${status}`,
            statusEmoji,
            progress,
            events,
            lastUpdated: new Date().toISOString(),
            estimatedDelivery: calculateEstimatedDelivery(events)
        };
    } catch (fallbackError) {
        console.error('Erro no fallback também:', fallbackError);
        throw new Error('Não foi possível obter informações de rastreamento');
    }
}

// Função para calcular entrega estimada (simplificado)
function calculateEstimatedDelivery(events) {
    if (!events || events.length === 0) return null;
    
    const firstEvent = events[events.length - 1]; // Evento mais antigo
    const firstDate = new Date(firstEvent.timestamp || new Date());
    
    // Adiciona 7-15 dias úteis para entrega estimada
    const estimatedDate = new Date(firstDate);
    estimatedDate.setDate(estimatedDate.getDate() + 10);
    
    return estimatedDate.toISOString();
}

// Função para criar embed do Discord
function createTrackingEmbed(trackingInfo, isUpdate = false) {
    const embed = new EmbedBuilder()
        .setColor(isUpdate ? 0x00FF00 : 0x0099FF)
        .setTitle(`${isUpdate ? '📦 ATUALIZAÇÃO DE ENCOMENDA' : '📦 INFORMAÇÕES DE RASTREIO'}`)
        .setDescription(`Código de rastreamento: **${trackingInfo.trackingCode}**`)
        .addFields(
            { name: '📊 Status Atual', value: `${trackingInfo.status}`, inline: true },
            { name: '📈 Progresso', value: `${trackingInfo.progress}%`, inline: true },
            { name: '🕒 Última Atualização', value: formatDateTime(trackingInfo.lastUpdated), inline: true }
        );
    
    // Adicionar previsão de entrega se disponível
    if (trackingInfo.estimatedDelivery) {
        embed.addFields({
            name: '📅 Previsão de Entrega',
            value: formatDateTime(trackingInfo.estimatedDelivery),
            inline: true
        });
    }
    
    // Adicionar últimos eventos (máximo 3)
    if (trackingInfo.events && trackingInfo.events.length > 0) {
        const recentEvents = trackingInfo.events.slice(0, 3);
        embed.addFields({
            name: `📋 Últimas Atualizações (${recentEvents.length}/${trackingInfo.events.length})`,
            value: recentEvents.map(event => 
                `• ${event.time}: ${event.message}`
            ).join('\n')
        });
    }
    
    embed.setFooter({ text: 'Sistema de Rastreamento Shopee • Atualizado' })
         .setTimestamp();
    
    return embed;
}

// Função para enviar mensagem DM para um usuário
async function sendDM(userId, message, embed = null) {
    try {
        const user = await discordClient.users.fetch(userId);
        if (embed) {
            await user.send({ content: message, embeds: [embed] });
        } else {
            await user.send(message);
        }
        return true;
    } catch (error) {
        console.error(`Erro ao enviar DM para ${userId}:`, error);
        return false;
    }
}

// Função para verificar atualizações
async function checkForUpdates() {
    console.log('🔍 Verificando atualizações via API...');
    
    for (const [trackingCode, data] of Object.entries(trackingData)) {
        try {
            const currentInfo = await getTrackingInfo(trackingCode);
            const currentStatus = currentInfo.status;
            
            // Verificar se houve mudança de status
            if (data.lastStatus !== currentStatus) {
                console.log(`🔄 Status alterado para ${trackingCode}: ${data.lastStatus} -> ${currentStatus}`);
                
                // Criar embed para a atualização
                const updateEmbed = createTrackingEmbed(currentInfo, true);
                
                // Notificar todos os usuários registrados
                for (const userId of data.users) {
                    const message = `📦 **ATUALIZAÇÃO DE ENCOMENDA**\nSeu pedido ${trackingCode} teve uma atualização!`;
                    await sendDM(userId, message, updateEmbed);
                }
                
                // Atualizar dados
                trackingData[trackingCode].lastStatus = currentStatus;
                trackingData[trackingCode].history = currentInfo.events;
                saveData();
            }
        } catch (error) {
            console.error(`❌ Erro ao verificar ${trackingCode} via API:`, error);
            
            // Tentar fallback para códigos importantes
            if (data.users.length > 0) {
                try {
                    const currentInfo = await getTrackingInfoFallback(trackingCode);
                    if (data.lastStatus !== currentInfo.status) {
                        console.log(`🔄 Status alterado (fallback) para ${trackingCode}: ${data.lastStatus} -> ${currentInfo.status}`);
                        
                        const updateEmbed = createTrackingEmbed(currentInfo, true);
                        
                        for (const userId of data.users) {
                            const message = `📦 **ATUALIZAÇÃO DE ENCOMENDA**\nSeu pedido ${trackingCode} teve uma atualização!`;
                            await sendDM(userId, message, updateEmbed);
                        }
                        
                        trackingData[trackingCode].lastStatus = currentInfo.status;
                        trackingData[trackingCode].history = currentInfo.events;
                        saveData();
                    }
                } catch (fallbackError) {
                    console.error(`❌ Fallback também falhou para ${trackingCode}`);
                }
            }
        }
    }
}

// Event listener for when the bot is ready
discordClient.once(Events.ClientReady, (readyClient) => {
    console.log(`🤖 Bot Discord logado como ${readyClient.user.tag}!`);
    
    // Iniciar servidor HTTP APÓS o bot do Discord estar pronto
    app.listen(PORT, () => {
        console.log(`🌐 Servidor rodando na porta ${PORT}`);
    });
    
    // Verificar atualizações a cada 5 minutos
    setInterval(checkForUpdates, 5 * 60 * 1000);
    
    // Verificar imediatamente ao iniciar
    setTimeout(checkForUpdates, 10000);
});

// Event listener for message events
discordClient.on(Events.MessageCreate, async (message) => {
    // Ignorar mensagens de bots e que não começam com o prefixo
    if (message.author.bot || !message.content.startsWith('!rastrear')) return;

    try {
        const args = message.content.split(' ');
        if (args.length < 2) {
            return message.reply('❌ Por favor, use: `!rastrear <código_rastreamento>`');
        }

        const trackingCode = args[1];
        const userId = message.author.id;

        // Validar formato do código de rastreamento
        if (!isValidTrackingCode(trackingCode)) {
            return message.reply('❌ Código de rastreamento inválido. Formatos aceitos: BR123456789BR, LX123456789US, etc.');
        }

        // Mostrar que está processando
        const processingMsg = await message.reply('🔍 Buscando informações de rastreamento...');

        try {
            const trackingInfo = await getTrackingInfo(trackingCode);
            
            // Registrar/atualizar dados
            if (!trackingData[trackingCode]) {
                trackingData[trackingCode] = {
                    users: [],
                    lastStatus: trackingInfo.status,
                    history: trackingInfo.events,
                    createdAt: new Date().toISOString()
                };
            }

            // Adicionar usuário se não estiver registrado
            if (!trackingData[trackingCode].users.includes(userId)) {
                trackingData[trackingCode].users.push(userId);
                saveData();
            }

            // Atualizar embed
            const embed = createTrackingEmbed(trackingInfo);
            
            // Editar mensagem original com os resultados
            await processingMsg.edit({ 
                content: `✅ Rastreamento para **${trackingCode}** - ${trackingInfo.status}`, 
                embeds: [embed] 
            });

        } catch (apiError) {
            console.error('Erro na API, tentando fallback:', apiError);
            
            try {
                const trackingInfo = await getTrackingInfoFallback(trackingCode);
                
                // Registrar/atualizar dados
                if (!trackingData[trackingCode]) {
                    trackingData[trackingCode] = {
                        users: [],
                        lastStatus: trackingInfo.status,
                        history: trackingInfo.events,
                        createdAt: new Date().toISOString()
                    };
                }

                if (!trackingData[trackingCode].users.includes(userId)) {
                    trackingData[trackingCode].users.push(userId);
                    saveData();
                }

                const embed = createTrackingEmbed(trackingInfo);
                
                await processingMsg.edit({ 
                    content: `⚠️ Usando método alternativo para **${trackingCode}** - ${trackingInfo.status}`, 
                    embeds: [embed] 
                });
            } catch (fallbackError) {
                await processingMsg.edit('❌ Não foi possível obter informações de rastreamento. Tente novamente mais tarde.');
            }
        }

    } catch (error) {
        console.error('Erro no comando de rastreamento:', error);
        message.reply('❌ Ocorreu um erro ao processar sua solicitação.');
    }
});

// Função para validar código de rastreamento
function isValidTrackingCode(code) {
    return code && code.length >= 10 && code.length <= 20;
}

// Rotas da API
app.get('/track/:code', async (req, res) => {
    try {
        const trackingCode = req.params.code;
        const trackingInfo = await getTrackingInfo(trackingCode);
        
        // Formatar resposta para melhor visualização
        const formattedResponse = {
            success: trackingInfo.success,
            trackingCode: trackingInfo.trackingCode,
            status: trackingInfo.status,
            progress: `${trackingInfo.progress}%`,
            events: trackingInfo.events.map(event => ({
                time: event.time,
                message: event.message
            })),
            lastUpdated: formatDateTime(trackingInfo.lastUpdated),
            estimatedDelivery: trackingInfo.estimatedDelivery ? formatDateTime(trackingInfo.estimatedDelivery) : null
        };
        
        res.json(formattedResponse);
    } catch (error) {
        console.error('Erro na rota /track:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao buscar informações de rastreamento',
            error: error.message
        });
    }
});

app.post('/track', async (req, res) => {
    try {
        const { trackingCode, discordId } = req.body;
        
        if (!trackingCode || !discordId) {
            return res.status(400).json({
                success: false,
                message: 'Código de rastreamento e ID do Discord são obrigatórios'
            });
        }
        
        if (!isValidTrackingCode(trackingCode)) {
            return res.status(400).json({
                success: false,
                message: 'Código de rastreamento inválido'
            });
        }
        
        // Registrar usuário para receber notificações
        if (!trackingData[trackingCode]) {
            trackingData[trackingCode] = {
                users: [],
                lastStatus: '',
                history: [],
                createdAt: new Date().toISOString()
            };
        }
        
        if (!trackingData[trackingCode].users.includes(discordId)) {
            trackingData[trackingCode].users.push(discordId);
            saveData();
        }
        
        // Buscar informações atuais
        const trackingInfo = await getTrackingInfo(trackingCode);
        trackingData[trackingCode].lastStatus = trackingInfo.status;
        trackingData[trackingCode].history = trackingInfo.events;
        saveData();
        
        res.json({
            success: true,
            message: 'Registrado para receber atualizações',
            trackingInfo: {
                trackingCode: trackingInfo.trackingCode,
                status: trackingInfo.status,
                progress: `${trackingInfo.progress}%`,
                lastUpdated: formatDateTime(trackingInfo.lastUpdated)
            }
        });
    } catch (error) {
        console.error('Erro na rota /track POST:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao processar solicitação',
            error: error.message
        });
    }
});

app.get('/users', (req, res) => {
    res.json({
        success: true,
        data: trackingData
    });
});

app.delete('/track/:code', (req, res) => {
    try {
        const trackingCode = req.params.code;
        const { discordId } = req.body;
        
        if (!discordId) {
            return res.status(400).json({
                success: false,
                message: 'ID do Discord é obrigatório'
            });
        }
        
        if (trackingData[trackingCode]) {
            trackingData[trackingCode].users = trackingData[trackingCode].users.filter(id => id !== discordId);
            
            // Remover código se não houver mais usuários
            if (trackingData[trackingCode].users.length === 0) {
                delete trackingData[trackingCode];
            }
            
            saveData();
        }
        
        res.json({
            success: true,
            message: 'Parou de receber notificações para este código'
        });
    } catch (error) {
        console.error('Erro na rota DELETE /track:', error);
        res.status(500).json({
            success: false,
            message: 'Erro ao processar solicitação'
        });
    }
});

// Log in to Discord with your bot's token
console.log('🔗 Iniciando bot do Discord...');
discordClient.login(DISCORD_BOT_TOKEN)
    .then(() => {
        console.log('✅ Bot do Discord conectado com sucesso!');
    })
    .catch(error => {
        console.error('❌ Erro ao conectar bot do Discord:', error);
        process.exit(1);
    });

// Manipular encerramento graceful
process.on('SIGINT', () => {
    console.log('🛑 Encerrando servidor...');
    if (discordClient.isReady()) {
        discordClient.destroy();
    }
    process.exit(0);
});

// Exportar para testes
module.exports = { app, discordClient, getTrackingInfo, trackingData, saveData };
