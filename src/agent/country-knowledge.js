'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// HARDCODED COUNTRY KNOWLEDGE
// ─────────────────────────────────────────────────────────────────────────────

const COUNTRY_DATA = {
  CO: {
    countryName: 'Colombia',
    currency: 'COP',
    systemPromptAddition: `
## CONOCIMIENTO FISCAL — COLOMBIA
- **Entidad tributaria**: DIAN (Dirección de Impuestos y Aduanas Nacionales)
- **Marco contable**: PUC (Plan Único de Cuentas), NCIF convergencia IFRS
- **UVT 2024**: $47.065 COP

### IVA
- Tarifa general: 19%
- Tarifas reducidas: 5% (medicina prepagada, algunos alimentos)
- Excluidos: educación, salud, servicios públicos domiciliarios
- No responsables: ingresos < 3.500 UVT anuales (~$165M COP)

### Retención en la Fuente
- Honorarios persona natural: 10%
- Honorarios persona jurídica que declara renta: 11%
- Servicios: 4% (pequeños) / 6% (grandes contribuyentes)
- Compras: 2.5% / 3.5%
- Arrendamientos: 3.5%
- Rendimientos financieros: 7%

### ICA (Impuesto de Industria y Comercio)
- Varía por municipio y actividad. Bogotá: 2-14 por mil.

### Renta Personas Naturales
- Renta exenta: hasta 1.090 UVT (~$51M COP 2024)
- Tarifas: 0%, 19%, 28%, 33%, 35%, 37%, 39%

### Renta Personas Jurídicas
- Tarifa general: 35%
- Régimen Simple de Tributación: 1.8%-14.5%

### Plataformas locales
Nequi, Bancolombia, Daviplata, Davivienda, BBVA, PSE, PayU, ePayco, Payoneer, Wise, Stripe, Bold, Rappi Pay, Efecty, Baloto

### Documentos válidos
Factura electrónica DIAN, documento equivalente, extracto bancario, contrato de servicios
`
  },

  US: {
    countryName: 'United States',
    currency: 'USD',
    systemPromptAddition: `
## TAX KNOWLEDGE — UNITED STATES
- **Tax authority**: IRS (Internal Revenue Service)
- **Tax year**: Calendar year (Jan 1 – Dec 31)

### Income Tax Brackets 2024 (Single)
- 10%: $0 – $11,600
- 12%: $11,601 – $47,150
- 22%: $47,151 – $100,525
- 24%: $100,526 – $191,950
- 32%: $191,951 – $243,725
- 35%: $243,726 – $609,350
- 37%: Over $609,350

### Standard Deduction 2024
- Single: $14,600
- Married Filing Jointly: $29,200

### Self-Employment
- FICA (Self-employment tax): 15.3% (12.4% SS + 2.9% Medicare)
- Schedule C for business income/expenses
- Quarterly estimated taxes (Form 1040-ES)

### Business Structures
- LLC (pass-through taxation), S-Corp, C-Corp (21% flat rate)

### Key Forms
- W-2: Employee wages
- 1099-NEC: Non-employee compensation >$600
- 1099-MISC: Miscellaneous income
- Schedule C: Profit or loss from business

### Sales Tax
- Varies by state (0%–10.25%), collected at point of sale
`
  },

  MX: {
    countryName: 'México',
    currency: 'MXN',
    systemPromptAddition: `
## CONOCIMIENTO FISCAL — MÉXICO
- **Autoridad fiscal**: SAT (Servicio de Administración Tributaria)
- **Año fiscal**: Enero–Diciembre

### IVA (Impuesto al Valor Agregado)
- Tarifa general: 16%
- Tasa 0%: alimentos no procesados, medicinas, exportaciones
- Exento: educación, servicios médicos

### ISR (Impuesto Sobre la Renta)
- Personas físicas: tarifas progresivas hasta 35%
- Personas morales: 30% tasa general
- RESICO (Régimen Simplificado de Confianza): 1%–2.5% para pequeños contribuyentes

### CFDI (Comprobante Fiscal Digital por Internet)
- Factura electrónica obligatoria para todas las transacciones comerciales
- Versión 4.0 vigente desde 2023

### Regímenes
- Actividades empresariales y profesionales
- Arrendamiento
- RESICO Personas Físicas (ingresos hasta $3.5M MXN)
- Personas Morales RESICO

### Retenciones ISR
- Honorarios a personas físicas: 10%
- Arrendamiento: 10% ISR

### Declaraciones
- Mensual: IVA e ISR provisional
- Anual: Declaración anual (Abril para PM, Mayo para PF)
`
  },

  AR: {
    countryName: 'Argentina',
    currency: 'ARS',
    systemPromptAddition: `
## CONOCIMIENTO FISCAL — ARGENTINA
- **Autoridad fiscal**: AFIP (Administración Federal de Ingresos Públicos)
- **Año fiscal**: Enero–Diciembre

### IVA
- Tarifa general: 21%
- Tasa reducida: 10.5% (alimentos, bienes de capital)
- Tasa 0%: exportaciones, algunos alimentos básicos

### Monotributo
- Régimen simplificado para pequeños contribuyentes
- Categorías A-K según ingresos brutos anuales
- Incluye IVA, Ganancias y aportes previsionales en una cuota fija

### Responsable Inscripto (IVA)
- Para facturar con IVA discriminado
- Declaraciones mensuales de IVA
- Retenciones de Ganancias e Ingresos Brutos

### Ganancias (Impuesto a las Ganancias)
- Personas físicas: escala progresiva
- Personas jurídicas: 25%–35% según utilidades
- Mínimo no imponible y deducciones personales

### Ingresos Brutos
- Impuesto provincial/municipal
- Tarifas variables según provincia y actividad (1.5%–5%)
- Convenio multilateral para actividades en múltiples provincias

### Facturación
- Factura A: entre Responsables Inscriptos
- Factura B: a consumidores finales y monotributistas
- Factura C: emitida por monotributistas
`
  },

  ES: {
    countryName: 'España',
    currency: 'EUR',
    systemPromptAddition: `
## CONOCIMIENTO FISCAL — ESPAÑA
- **Autoridad fiscal**: AEAT (Agencia Estatal de Administración Tributaria)
- **Año fiscal**: Enero–Diciembre

### IVA (Impuesto sobre el Valor Añadido)
- Tipo general: 21%
- Tipo reducido: 10% (alimentos, hostelería, transporte)
- Tipo superreducido: 4% (alimentos básicos, medicamentos, libros)
- Exento: educación, sanidad, seguros, servicios financieros

### IRPF (Impuesto sobre la Renta de las Personas Físicas)
- Tarifas progresivas: 19%, 24%, 30%, 37%, 45%, 47%
- Rendimientos del trabajo, actividades económicas, capital
- Retenciones: 15% honorarios profesionales (7% inicio actividad), 19% rendimientos capital

### Autónomos
- Cuota mensual Seguridad Social: desde ~€230 (sistema de ingresos reales desde 2023)
- Retención IRPF sobre facturas: 15% general, 7% primeros 3 años
- IVA trimestral (Modelo 303)
- IRPF trimestral (Modelo 130)

### Sociedades
- Tipo general: 25%
- Pymes primer año y siguientes con beneficios: 15% (primeros €300.000)

### Modelos AEAT
- Modelo 303: IVA trimestral
- Modelo 130: Pago fraccionado IRPF trimestral
- Modelo 100: Declaración Renta anual
- Modelo 347: Operaciones con terceros >€3.005 anuales

### Facturas
- Factura simplificada (ticket): hasta €3.000
- Factura completa: entre empresas y profesionales
- Factura electrónica: obligatoria entre empresas (Ley Crea y Crece)
`
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZE COUNTRY NAME → CODE
// ─────────────────────────────────────────────────────────────────────────────

const COUNTRY_ALIASES = {
  'colombia': 'CO',
  'colombiano': 'CO',
  'colombiana': 'CO',
  'usa': 'US',
  'united states': 'US',
  'estados unidos': 'US',
  'eeuu': 'US',
  'mexico': 'MX',
  'méxico': 'MX',
  'mexicano': 'MX',
  'argentina': 'AR',
  'argentino': 'AR',
  'spain': 'ES',
  'españa': 'ES',
  'espana': 'ES',
  'español': 'ES',
  'española': 'ES'
};

function normalizeCountryCode(input) {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  if (COUNTRY_DATA[input.toUpperCase()]) return input.toUpperCase();
  return COUNTRY_ALIASES[lower] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DYNAMIC COUNTRY KNOWLEDGE VIA CLAUDE
// ─────────────────────────────────────────────────────────────────────────────

async function generateDynamicKnowledge(countryName) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are a tax expert. Provide detailed tax and accounting knowledge for ${countryName} in Spanish.

Return a JSON object with this exact structure:
{
  "countryName": "official country name in Spanish",
  "currency": "ISO 4217 currency code",
  "systemPromptAddition": "detailed tax knowledge in Spanish covering: tax authority, main taxes (income tax, VAT/sales tax), tax rates, filing requirements, common deductions, and any important accounting rules"
}

Only return valid JSON, no extra text.`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    // fallback
  }

  return {
    countryName,
    currency: 'USD',
    systemPromptAddition: `País: ${countryName}. Consulta las regulaciones fiscales locales vigentes.`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

async function getCountryKnowledge(countryCode) {
  const code = countryCode ? countryCode.toUpperCase() : null;

  if (code && COUNTRY_DATA[code]) {
    return COUNTRY_DATA[code];
  }

  // Unknown country — generate dynamically
  const countryName = countryCode || 'Unknown';
  return await generateDynamicKnowledge(countryName);
}

module.exports = {
  getCountryKnowledge,
  normalizeCountryCode,
  COUNTRY_DATA
};
