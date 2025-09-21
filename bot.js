require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Client, GatewayIntentBits, Events, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
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
const CLIENT_ID = process.env.CLIENT_ID;

if (!DISCORD_BOT_TOKEN || !CLIENT_ID) {
    console.error('❌ ERROR: Variáveis de ambiente não encontradas');
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

        return {
            success: true,
            trackingCode,
            status: `${statusEmoji} ${status}`,
            statusEmoji,
            events,
            lastUpdated: new Date().toISOString(),
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

// Função para criar embed do Discord
function createTrackingEmbed(trackingInfo, isUpdate = false) {
    const embed = new EmbedBuilder()
        .setColor(isUpdate ? 0x00FF00 : 0x0099FF)
        .setTitle(`${isUpdate ? '📦 ATUALIZAÇÃO DE ENCOMENDA' : '📦 INFORMAÇÕES DE RASTREIO'}`)
        .setDescription(`Código de rastreamento: **${trackingInfo.trackingCode}**`)
        .addFields(
            { name: '📊 Status Atual', value: `${trackingInfo.status}`, inline: true },
            { name: '🕒 Última Atualização', value: formatDateTime(trackingInfo.lastUpdated), inline: true }
        );
    
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

// Definir comandos slash
const commands = [
    new SlashCommandBuilder()
        .setName('rastrear')
        .setDescription('Rastreia um código de encomenda da Shopee')
        .addStringOption(option =>
            option.setName('codigo')
                .setDescription('Código de rastreamento (ex: BR123456789BR)')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('meusrastreamentos')
        .setDescription('Lista todos os pedidos que você está rastreando'),
    
    new SlashCommandBuilder()
        .setName('removerrastreamento')
        .setDescription('Para de acompanhar um pedido')
        .addStringOption(option =>
            option.setName('codigo')
                .setDescription('Código de rastreamento que deseja remover')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Verifica a latência do bot')
];

// Registrar comandos slash
const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);

async function registerCommands() {
    try {
        console.log('🔧 Registrando comandos slash...');
        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            { body: commands }
        );
        console.log('✅ Comandos slash registrados com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao registrar comandos:', error);
    }
}

// Função para validar código de rastreamento
function isValidTrackingCode(code) {
    return code && code.length >= 10 && code.length <= 20;
}

// Event listener for when the bot is ready
discordClient.once(Events.ClientReady, async (readyClient) => {
    console.log(`🤖 Bot Discord logado como ${readyClient.user.tag}!`);
    
    // Registrar comandos slash
    await registerCommands();
    
    // Iniciar servidor HTTP
    app.listen(PORT, () => {
        console.log(`🌐 Servidor rodando na porta ${PORT}`);
    });
    
    // Verificar atualizações a cada 5 minutos
    setInterval(checkForUpdates, 5 * 60 * 1000);
    
    // Verificar imediatamente ao iniciar
    setTimeout(checkForUpdates, 10000);
});

// Handler de comandos slash
discordClient.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, user } = interaction;

    try {
        // Comando /rastrear
        if (commandName === 'rastrear') {
            await interaction.deferReply();
            
            const trackingCode = options.getString('codigo');
            const userId = user.id;

            // Validar formato do código de rastreamento
            if (!isValidTrackingCode(trackingCode)) {
                return interaction.editReply('❌ Código de rastreamento inválido. Formatos aceitos: BR123456789BR, LX123456789US, etc.');
            }

            // Verificar se já está registrado e é o mesmo usuário
            if (trackingData[trackingCode] && trackingData[trackingCode].users.includes(userId)) {
                return interaction.editReply('❌ Você já está registrado para receber atualizações deste código de rastreamento.');
            }

            try {
                const trackingInfo = await getTrackingInfo(trackingCode);
                
                // Verificar se já foi entregue
                if (trackingInfo.isDelivered) {
                    const embed = createTrackingEmbed(trackingInfo);
                    return interaction.editReply({ 
                        content: `✅ Pedido **${trackingCode}** já foi entregue!`, 
                        embeds: [embed] 
                    });
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
                
                await interaction.editReply({ 
                    content: `✅ Registrado para **${trackingCode}** - ${trackingInfo.status}\nVocê receberá atualizações automáticas!`, 
                    embeds: [embed] 
                });

            } catch (error) {
                console.error('Erro na API:', error);
                await interaction.editReply('❌ Não foi possível obter informações de rastreamento. Verifique o código e tente novamente.');
            }
        }

        // Comando /meusrastreamentos
        else if (commandName === 'meusrastreamentos') {
            await interaction.deferReply();
            
            const userId = user.id;
            const userTrackings = [];
            
            for (const [trackingCode, data] of Object.entries(trackingData)) {
                if (data.users.includes(userId)) {
                    userTrackings.push({
                        code: trackingCode,
                        status: data.lastStatus,
                        registered: data.createdAt
                    });
                }
            }
            
            if (userTrackings.length === 0) {
                return interaction.editReply('❌ Você não está rastreando nenhum pedido no momento.');
            }
            
            const embed = new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle('📦 SEUS RASTREAMENTOS ATIVOS')
                .setDescription(`Você está acompanhando ${userTrackings.length} pedido(s)`)
                .addFields(
                    userTrackings.map(tracking => ({
                        name: `📦 ${tracking.code}`,
                        value: `Status: ${tracking.status}\nRegistrado em: ${formatDateTime(tracking.registered)}`,
                        inline: false
                    }))
                )
                .setFooter({ text: 'Use /removerrastreamento para parar de acompanhar' });
            
            await interaction.editReply({ embeds: [embed] });
        }

        // Comando /removerrastreamento
        else if (commandName === 'removerrastreamento') {
            await interaction.deferReply();
            
            const trackingCode = options.getString('codigo');
            const userId = user.id;
            
            if (!trackingData[trackingCode]) {
                return interaction.editReply('❌ Código de rastreamento não encontrado.');
            }
            
            if (!trackingData[trackingCode].users.includes(userId)) {
                return interaction.editReply('❌ Você não está rastreando este pedido.');
            }
            
            // Remover usuário da lista
            trackingData[trackingCode].users = trackingData[trackingCode].users.filter(id => id !== userId);
            
            // Se não houver mais usuários, remover completamente
            if (trackingData[trackingCode].users.length === 0) {
                delete trackingData[trackingCode];
            }
            
            saveData();
            
            await interaction.editReply(`✅ Você parou de acompanhar o pedido **${trackingCode}**.`);
        }

        // Comando /ping
        else if (commandName === 'ping') {
            await interaction.deferReply();
            
            const start = Date.now();
            const end = Date.now();
            
            await interaction.editReply(`🏓 Pong! Latência: ${end - start}ms | Latência da API: ${Math.round(discordClient.ws.ping)}ms`);
        }

    } catch (error) {
        console.error('Erro no comando slash:', error);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply('❌ Ocorreu um erro ao processar sua solicitação.');
        } else {
            await interaction.reply('❌ Ocorreu um erro ao processar sua solicitação.');
        }
    }
});

// Event listener for message events (comandos de texto legado)
discordClient.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    
    // Comando !meusrastreamentos
    if (message.content === '!meusrastreamentos') {
        const userId = message.author.id;
        const userTrackings = [];
        
        for (const [trackingCode, data] of Object.entries(trackingData)) {
            if (data.users.includes(userId)) {
                userTrackings.push({
                    code: trackingCode,
                    status: data.lastStatus,
                    registered: data.createdAt
                });
            }
        }
        
        if (userTrackings.length === 0) {
            return message.reply('❌ Você não está rastreando nenhum pedido no momento.');
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x0099FF)
            .setTitle('📦 SEUS RASTREAMENTOS ATIVOS')
            .setDescription(`Você está acompanhando ${userTrackings.length} pedido(s)`)
            .addFields(
                userTrackings.map(tracking => ({
                    name: `📦 ${tracking.code}`,
                    value: `Status: ${tracking.status}\nRegistrado em: ${formatDateTime(tracking.registered)}`,
                    inline: false
                }))
            )
            .setFooter({ text: 'Use !removerrastreamento <código> para parar de acompanhar' });
        
        message.reply({ embeds: [embed] });
    }
    
    // Comando !removerrastreamento
    else if (message.content.startsWith('!removerrastreamento')) {
        const args = message.content.split(' ');
        if (args.length < 2) {
            return message.reply('❌ Por favor, use: `!removerrastreamento <código_rastreamento>`');
        }
        
        const trackingCode = args[1];
        const userId = message.author.id;
        
        if (!trackingData[trackingCode]) {
            return message.reply('❌ Código de rastreamento não encontrado.');
        }
        
        if (!trackingData[trackingCode].users.includes(userId)) {
            return message.reply('❌ Você não está rastreando este pedido.');
        }
        
        // Remover usuário da lista
        trackingData[trackingCode].users = trackingData[trackingCode].users.filter(id => id !== userId);
        
        // Se não houver mais usuários, remover completamente
        if (trackingData[trackingCode].users.length === 0) {
            delete trackingData[trackingCode];
        }
        
        saveData();
        
        message.reply(`✅ Você parou de acompanhar o pedido **${trackingCode}**.`);
    }
    
    // Comando !ping
    else if (message.content === '!ping') {
        const start = Date.now();
        const pingMsg = await message.reply('🏓 Pong! Calculando...');
        const end = Date.now();
        
        pingMsg.edit(`🏓 Pong! Latência: ${end - start}ms | Latência da API: ${Math.round(discordClient.ws.ping)}ms`);
    }
    
    // Comando !rastrear (legado)
    else if (message.content.startsWith('!rastrear')) {
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
    }
});

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

// Nova rota: Ping
app.get('/ping', (req, res) => {
    const start = Date.now();
    
    setTimeout(() => {
        const responseTime = Date.now() - start;
        res.json({
            status: 'online',
            responseTime: `${responseTime}ms`,
            timestamp: new Date().toISOString(),
            trackingsCount: Object.keys(trackingData).length
        });
    }, 10);
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
