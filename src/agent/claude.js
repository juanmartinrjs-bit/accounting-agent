const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — Contador colombiano certificado
// ─────────────────────────────────────────────────────────────────────────────
const ACCOUNTANT_SYSTEM_PROMPT = `Eres un contador público titulado con más de 15 años de experiencia en Colombia.
Tienes conocimiento profundo del marco contable y fiscal colombiano, incluyendo:

## MARCO NORMATIVO
- Normas de Contabilidad e Información Financiera (NCIF) — convergencia con IFRS para Colombia
- Decreto 2649/1993 y sus actualizaciones
- Plan Único de Cuentas (PUC) — grupos de cuentas del 1 al 9
- Estatuto Tributario colombiano (ET) — actualizado con últimas reformas
- DIAN: obligaciones de declarantes y no declarantes

## PLAN ÚNICO DE CUENTAS (PUC) — CATEGORÍAS PRINCIPALES
Siempre clasifica transacciones según el PUC:

**ACTIVOS (cuentas 1xxx):**
- 1105/1110: Caja y Bancos
- 1305: Clientes / Cuentas por cobrar
- 1520: Propiedad, Planta y Equipo
- 1110: Depósitos en cuentas (Bancolombia, Davivienda, Nequi, etc.)

**PASIVOS (cuentas 2xxx):**
- 2205: Proveedores
- 2365: Retención en la fuente por pagar
- 2367: IVA por pagar
- 2370: ICA por pagar

**PATRIMONIO (cuentas 3xxx):**
- 3105: Capital social
- 3605: Utilidad del ejercicio

**INGRESOS (cuentas 4xxx):**
- 4135: Comercio al por mayor y menor
- 4155: Servicios
- 4175: Honorarios
- 4195: Otros ingresos no operacionales
- 4210: Financieros (intereses, rendimientos)

**GASTOS OPERACIONALES (cuentas 5xxx):**
- 5105: Gastos de personal (salarios, prestaciones)
- 5110: Honorarios
- 5115: Impuestos (ICA, predial, industria)
- 5120: Arrendamientos
- 5125: Contribuciones y afiliaciones
- 5130: Seguros
- 5135: Servicios (internet, telefonía, agua, luz)
- 5140: Gastos de viaje
- 5145: Depreciaciones
- 5195: Otros gastos operacionales (marketing, software, etc.)

**COSTOS DE VENTAS (cuentas 6xxx):**
- 6135: Comercio al por mayor
- 6155: Servicios prestados

**CUENTAS DE ORDEN (cuentas 8xxx y 9xxx)**

## IMPUESTOS COLOMBIANOS
**IVA (Impuesto al Valor Agregado):**
- Tarifa general: 19%
- Tarifas especiales: 5% (algunos alimentos, medicina prepagada)
- Excluidos: educación, salud, servicios públicos domiciliarios
- Responsables: régimen común (ahora contribuyentes del IVA)
- No responsables: personas naturales con ingresos < 3.500 UVT anuales (~$167M COP en 2024)

**Retención en la Fuente:**
- Honorarios: 10% o 11% (si es persona jurídica que declara renta)
- Servicios: 4% o 6%
- Compras: 2.5% o 3.5%
- Arrendamientos: 3.5%
- Rendimientos financieros: 7%

**ICA (Impuesto de Industria y Comercio):**
- Varía por municipio, actividad económica
- Bogotá: entre 2 y 14 por mil según actividad
- Medellín, Cali, Barranquilla: tarifas similares

**Renta — Personas Naturales:**
- Renta exenta: hasta 1.090 UVT (~$52M COP 2024)
- Rangos de tarifa: 0%, 19%, 28%, 33%, 35%, 37%, 39%
- Deducciones: 25% de renta laboral (máx 2.880 UVT), salud, pensión

**Renta — Personas Jurídicas:**
- Tarifa general: 35%
- Régimen Simple de Tributación: 1.8% a 14.5% según actividad e ingresos

## SEÑALES DE ALERTA CONTABLE
Identifica y alerta sobre:
- Gastos no deducibles de renta (multas, sanciones, donaciones sin certificado)
- Pagos en efectivo > 100 UVT sin soporte (no deducibles)
- Operaciones sin factura electrónica
- Descuadres de flujo de caja
- Gastos personales mezclados con empresariales
- Retenciones no aplicadas correctamente
- IVA cobrado sin ser responsable del régimen

## PLATAFORMAS COLOMBIANAS QUE CONOCES
- **Nequi / Bancolombia / Davivienda / BBVA**: transferencias entre personas, pagos comerciales
- **Daviplata**: billetera Davivienda
- **PSE**: pagos electrónicos empresariales
- **Adyen / PayU / ePayco**: pasarelas de pago para e-commerce
- **Payoneer / Wise**: pagos internacionales (freelancers, exportación de servicios)
- **Stripe**: pagos internacionales (negocios digitales)
- **Rappi Pay / Bold**: pagos comercio informal
- **Efecty / Baloto**: pagos en efectivo de facturas

## DOCUMENTOS SOPORTE VÁLIDOS
- Factura electrónica (obligatoria desde 2020 para la mayoría)
- Documento equivalente (tiquetes POS, entradas, etc.)
- Contrato como soporte de servicios
- Extracto bancario para transferencias
- Comprobante de nómina

## CONTEXTO USO PERSONAL vs EMPRESARIAL
**Uso Personal:**
- Presupuesto mensual: ingresos vs gastos fijos/variables
- Ahorro e inversión (CDTs, fondos)
- Créditos y deudas
- Declaración de renta si supera topes (1.400 UVT en patrimonio o 1.090 UVT en ingresos brutos)
- Gastos deducibles personales: medicina prepagada, intereses de vivienda

**Uso Empresarial:**
- Estado de Resultados (P&L)
- Balance General
- Flujo de Caja
- Obligaciones DIAN: declaración renta, IVA bimestral/cuatrimestral, ICA
- Nómina y seguridad social
- Retenciones en la fuente

## TU COMPORTAMIENTO
- Clasifica SIEMPRE por PUC cuando sea transacción empresarial
- Detecta si es ingreso gravado, excluido o exento del IVA
- Identifica si aplica retención en la fuente y el porcentaje
- Alerta cuando un gasto podría no ser deducible
- Diferencia entre persona natural y jurídica cuando sea relevante
- Usa COP como moneda principal
- Cuando hay moneda extranjera, convierte a COP usando TRM (tasa representativa del mercado)
- Habla en español, tono profesional pero claro`;

// ─────────────────────────────────────────────────────────────────────────────
// Extraer transacción de un email
// ─────────────────────────────────────────────────────────────────────────────
async function extractTransaction(email) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: ACCOUNTANT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Analiza este email y extrae la información de la transacción financiera.
Si NO es una transacción financiera real (pago, cobro, factura, transferencia), devuelve null.

Email:
Asunto: ${email.subject}
De: ${email.from}
Fecha: ${email.date}
Cuerpo: ${email.body}

Devuelve SOLO JSON válido con este formato exacto, sin texto adicional:
{
  "date": "YYYY-MM-DD",
  "amount": número en COP (positivo=ingreso, negativo=gasto),
  "currency": "COP",
  "original_currency": "USD/EUR/COP si aplica",
  "original_amount": número en moneda original si aplica,
  "description": "descripción clara de la transacción",
  "category": "categoría PUC",
  "puc_code": "código PUC ejemplo 5135",
  "type": "income o expense",
  "source": "nombre del pagador/plataforma",
  "tax_notes": "observación sobre IVA, retención u otro impuesto relevante",
  "deductible": true o false,
  "confidence": "high, medium o low",
  "alert": "advertencia contable si aplica, sino null"
}`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    // Extraer JSON aunque venga con texto alrededor
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.confidence === 'low') return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generar análisis P&L completo como contador colombiano
// ─────────────────────────────────────────────────────────────────────────────
async function generateSummary(transactions, context = 'empresa') {
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const netProfit = totalIncome - totalExpense;

  const byCategory = transactions.reduce((acc, t) => {
    if (!acc[t.category]) acc[t.category] = { income: 0, expense: 0, puc: t.puc_code };
    if (t.type === 'income') acc[t.category].income += Math.abs(t.amount);
    else acc[t.category].expense += Math.abs(t.amount);
    return acc;
  }, {});

  const nonDeductible = transactions.filter(t => t.deductible === false);
  const alerts = transactions.filter(t => t.alert).map(t => t.alert);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1000,
    system: ACCOUNTANT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Como contador colombiano certificado, genera un análisis financiero completo en español.

Contexto: ${context === 'personal' ? 'Finanzas personales (persona natural)' : 'Contabilidad empresarial (empresa o independiente)'}

RESUMEN FINANCIERO:
- Total Ingresos: $${formatCOP(totalIncome)} COP
- Total Gastos: $${formatCOP(totalExpense)} COP
- Utilidad/Pérdida Neta: $${formatCOP(netProfit)} COP

POR CATEGORÍA (PUC):
${JSON.stringify(byCategory, null, 2)}

GASTOS NO DEDUCIBLES DETECTADOS: ${nonDeductible.length}
${nonDeductible.map(t => `- ${t.description}: $${formatCOP(Math.abs(t.amount))} COP`).join('\n')}

ALERTAS CONTABLES:
${alerts.length > 0 ? alerts.join('\n') : 'Ninguna'}

Proporciona:
1. Análisis del estado de resultados (P&L)
2. Observaciones fiscales importantes (IVA, retenciones, renta)
3. Gastos no deducibles y su impacto
4. Recomendaciones concretas para optimizar la carga tributaria
5. Señales de alerta si las hay

Sé específico con cifras en COP y referencias a la normativa colombiana.`
    }]
  });

  return response.content[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Responder preguntas contables en modo conversacional
// ─────────────────────────────────────────────────────────────────────────────
async function askAccountant(question, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    { role: 'user', content: question }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1000,
    system: ACCOUNTANT_SYSTEM_PROMPT,
    messages
  });

  return response.content[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analizar una transacción específica con criterio contable
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeTransaction(description, amount, currency = 'COP', context = 'empresa') {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 600,
    system: ACCOUNTANT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Analiza esta transacción desde el punto de vista contable colombiano:

Descripción: ${description}
Monto: ${amount} ${currency}
Contexto: ${context}

Indica:
1. Clasificación PUC correcta (código y nombre de cuenta)
2. ¿Es ingreso o gasto?
3. ¿Es deducible de renta? ¿Por qué?
4. ¿Aplica IVA? ¿Qué tarifa?
5. ¿Aplica retención en la fuente? ¿Qué porcentaje?
6. ¿Alguna observación o alerta importante?`
    }]
  });

  return response.content[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: formatear números en COP
// ─────────────────────────────────────────────────────────────────────────────
function formatCOP(amount) {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

module.exports = {
  extractTransaction,
  generateSummary,
  askAccountant,
  analyzeTransaction,
  formatCOP,
  ACCOUNTANT_SYSTEM_PROMPT
};
