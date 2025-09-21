require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
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

// TOKEN SEGURO - via variável de ambiente
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!DISCORD_BOT_TOKEN) {
    console.error('❌ ERROR: DISCORD_BOT_TOKEN não encontrado nas variáveis de ambiente');
    process.exit(1);
}

// URL da sua API no Vercel
const API_BASE_URL = process.env.API_BASE_URL || 'https://recebasddsa.vercel.app/api/shopee-tracker';

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
    
    const date = new Date(dateTimeStr);
    if (!isNaN(date.getTime())) {
        return date.toLocaleString('pt-BR');
    }
    
    if (dateTimeStr.includes('\n')) {
        const [datePart, timePart] = dateTimeStr.split('\n');
        return `${datePart} ${timePart}`;
    }
    
    return dateTimeStr;
}

// Função para verificar se pedido já foi entregue
function isDelivered(status) {
    const statusLower = status.toLowerCase();
    return statusLower.includes('entregue') || statusLower.includes('delivered');
}

// Função para obter informações de rastreamento da API
async function getTrackingInfo(trackingCode) {
    try {
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

        // Determinar status atual e emoji correspondente
        let status = apiData.tracking.status || 'Em processamento';
        let statusEmoji = '⏳';
        
        const statusLower = status.toLowerCase();
        if (isDelivered(status)) {
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
        if (isDelivered(status)) progress = 100;
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
            isDelivered: isDelivered(status),
            rawData: apiData
        };
    } catch (error) {
        console.error('Erro ao buscar informações da API:', error);
        
        if (error.response?.status === 404) {
            throw new Error('API de rastreamento não encontrada. Verifique a URL.');
        }
        
        throw new Error(`Erro na API: ${error.message}`);
    }
}

// Função para calcular entrega estimada
function calculateEstimatedDelivery(events) {
    if (!events || events.length === 0) return null;
    
    const firstEvent = events[events.length - 1];
    const firstDate = new Date(firstEvent.timestamp || new Date());
    
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
    
    if (trackingInfo.estimatedDelivery) {
        embed.addFields({
            name: '📅 Previsão de Entrega',
            value: formatDateTime(trackingInfo.estimatedDelivery),
            inline: true
        });
    }
    
    if (trackingInfo.events && trackingInfo.events.length > 0) {
        const recentEvents = trackingInfo.events.slice(0, 3);
        embed.addFields({
            name: `📋 Últimas Atualizações (${recentEvents.length}/${trackingInfo.events.length})`,
            value: recentEvents.map(event => 
                `• ${event.time}: ${event.message}`
            ).join('\n')
        });
    }
    
    if (trackingInfo.isDelivered) {
        embed.addFields({
            name: '🎉 Pedido Entregue',
            value: 'Este pedido já foi entregue! Não é necessário acompanhamento adicional.',
            inline: false
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
        // Pular pedidos já entregues
        if (data.isDelivered) {
            console.log(`📦 Pedido ${trackingCode} já entregue, pulando verificação`);
            continue;
        }
        
        try {
            const currentInfo = await getTrackingInfo(trackingCode);
            
            // Verificar se houve mudança de status
            if (data.lastStatus !== currentInfo.status) {
                console.log(`🔄 Status alterado para ${trackingCode}: ${data.lastStatus} -> ${currentInfo.status}`);
                
                const updateEmbed = createTrackingEmbed(currentInfo, true);
                
                // Notificar todos os usuários registrados
                for (const userId of data.users) {
                    const message = `📦 **ATUALIZAÇÃO DE ENCOMENDA**\nSeu pedido ${trackingCode} teve uma atualização!`;
                    await sendDM(userId, message, updateEmbed);
                }
                
                // Atualizar dados
                trackingData[trackingCode].lastStatus = currentInfo.status;
                trackingData[trackingCode].history = currentInfo.events;
                trackingData[trackingCode].isDelivered = currentInfo.isDelivered;
                saveData();
                
                // Se foi entregue, remover das verificações futuras
                if (currentInfo.isDelivered) {
                    console.log(`🎉 Pedido ${trackingCode} marcado como entregue, removendo das verificações`);
                }
            }
        } catch (error) {
            console.error(`❌ Erro ao verificar ${trackingCode} via API:`, error);
        }
    }
}

// Event listener for when the bot is ready
discordClient.once(Events.ClientReady, (readyClient) => {
    console.log(`🤖 Bot Discord logado como ${readyClient.user.tag}!`);
    
    // Iniciar servidor HTTP
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

        // Verificar se já está registrado e é o mesmo usuário
        if (trackingData[trackingCode] && trackingData[trackingCode].users.includes(userId)) {
            return message.reply('❌ Você já está registrado para receber atualizações deste código de rastreamento.');
        }

        const processingMsg = await message.reply('🔍 Buscando informações de rastreamento...');

        try {
            const trackingInfo = await getTrackingInfo(trackingCode);
            
            // Verificar se já foi entregue
            if (trackingInfo.isDelivered) {
                const embed = createTrackingEmbed(trackingInfo);
                await processingMsg.edit({ 
                    content: `✅ Pedido **${trackingCode}** já foi entregue!`, 
                    embeds: [embed] 
                });
                return;
            }

            // Registrar/atualizar dados
            if (!trackingData[trackingCode]) {
                trackingData[trackingCode] = {
                    users: [],
                    lastStatus: trackingInfo.status,
                    history: trackingInfo.events,
                    isDelivered: trackingInfo.isDelivered,
                    createdAt: new Date().toISOString()
                };
            }

            // Adicionar usuário se não estiver registrado
            if (!trackingData[trackingCode].users.includes(userId)) {
                trackingData[trackingCode].users.push(userId);
                saveData();
            }

            const embed = createTrackingEmbed(trackingInfo);
            
            await processingMsg.edit({ 
                content: `✅ Registrado para **${trackingCode}** - ${trackingInfo.status}\nVocê receberá atualizações automáticas!`, 
                embeds: [embed] 
            });

        } catch (error) {
            console.error('Erro na API:', error);
            await processingMsg.edit('❌ Não foi possível obter informações de rastreamento. Verifique o código e tente novamente.');
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
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'API de rastreamento SPX está funcionando',
        timestamp: new Date().toISOString()
    });
});

app.get('/track/:code', async (req, res) => {
    try {
        const trackingCode = req.params.code;
        const trackingInfo = await getTrackingInfo(trackingCode);
        
        const formattedResponse = {
            success: trackingInfo.success,
            trackingCode: trackingInfo.trackingCode,
            status: trackingInfo.status,
            progress: `${trackingInfo.progress}%`,
            isDelivered: trackingInfo.isDelivered,
            events: trackingInfo.events.map(event => ({
                time: event.time,
                message: event.message
            })),
            lastUpdated: formatDateTime(trackingInfo.lastUpdated)
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

app.get('/users', (req, res) => {
    res.json({
        success: true,
        totalTrackings: Object.keys(trackingData).length,
        data: trackingData
    });
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
    saveData();
    if (discordClient.isReady()) {
        discordClient.destroy();
    }
    process.exit(0);
});

module.exports = { app, discordClient, getTrackingInfo, trackingData, saveData };
