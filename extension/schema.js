/* Shared data model, rules and field definitions.
   Loaded by the client manager page and by the GST portal panel. */
(function (root) {
  'use strict';

  const CONSTITUTIONS = {
    proprietorship: {
      label: 'Proprietorship', portal: ['Proprietorship', 'Proprietor'], panChar: 'P',
      person: 'Proprietor', people: 'Proprietor', min: 1, max: 1,
      designations: ['Proprietor'],
      idLabel: null, idType: null
    },
    partnership: {
      label: 'Partnership firm', portal: ['Partnership'], panChar: 'F',
      person: 'Partner', people: 'Partners', min: 2, max: 99,
      designations: ['Partner', 'Managing Partner'],
      idLabel: 'Firm registration number (if registered with RoF)', idType: 'Registration number under the Partnership Act',
      idPattern: null
    },
    llp: {
      label: 'Limited Liability Partnership', portal: ['Limited Liability Partnership', 'LLP'], panChar: 'F',
      person: 'Designated Partner', people: 'Designated Partners', min: 2, max: 99,
      designations: ['Designated Partner'],
      idLabel: 'LLPIN', idType: 'Limited Liability Partnership Identification Number',
      idPattern: /^[A-Z]{3}-\d{4}$/, idHint: 'Format AAA-1234'
    },
    pvt_company: {
      label: 'Private Limited Company', portal: ['Private Limited Company'], panChar: 'C',
      person: 'Director', people: 'Directors', min: 2, max: 15,
      designations: ['Director', 'Managing Director', 'Whole-time Director'],
      idLabel: 'CIN', idType: 'Corporate Identity Number',
      idPattern: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, idHint: '21 characters, e.g. U74999MH2020PTC123456'
    },
    public_company: {
      label: 'Public Limited Company', portal: ['Public Limited Company'], panChar: 'C',
      person: 'Director', people: 'Directors', min: 3, max: 15,
      designations: ['Director', 'Managing Director', 'Whole-time Director'],
      idLabel: 'CIN', idType: 'Corporate Identity Number',
      idPattern: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/, idHint: '21 characters, e.g. L74999MH2020PLC123456'
    }
  };

  const STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
    'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
    'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra',
    'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
    'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];

  const STATE_CODES = {
    'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', 'Punjab': '03', 'Chandigarh': '04', 'Uttarakhand': '05', 'Haryana': '06',
    'Delhi': '07', 'Rajasthan': '08', 'Uttar Pradesh': '09', 'Bihar': '10', 'Sikkim': '11', 'Arunachal Pradesh': '12', 'Nagaland': '13',
    'Manipur': '14', 'Mizoram': '15', 'Tripura': '16', 'Meghalaya': '17', 'Assam': '18', 'West Bengal': '19', 'Jharkhand': '20',
    'Odisha': '21', 'Chhattisgarh': '22', 'Madhya Pradesh': '23', 'Gujarat': '24', 'Dadra and Nagar Haveli and Daman and Diu': '26',
    'Maharashtra': '27', 'Karnataka': '29', 'Goa': '30', 'Lakshadweep': '31', 'Kerala': '32', 'Tamil Nadu': '33', 'Puducherry': '34',
    'Andaman and Nicobar Islands': '35', 'Telangana': '36', 'Andhra Pradesh': '37', 'Ladakh': '38', 'Other Territory': '97'
  };
  // Tally sometimes spells states differently
  const STATE_ALIASES = { 'orissa': 'Odisha', 'pondicherry': 'Puducherry', 'new delhi': 'Delhi', 'nct of delhi': 'Delhi',
    'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu', 'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
    'dadra & nagar haveli and daman & diu': 'Dadra and Nagar Haveli and Daman and Diu', 'jammu & kashmir': 'Jammu and Kashmir',
    'andaman & nicobar islands': 'Andaman and Nicobar Islands', 'uttaranchal': 'Uttarakhand', 'chattisgarh': 'Chhattisgarh' };
  function stateCode(name) {
    if (!name) return '';
    if (/^\d{2}$/.test(name)) return name;
    const m = /^(\d{2})\s*[-–]/.exec(name);
    if (m) return m[1];
    const n = String(name).trim().toLowerCase();
    const canon = STATE_ALIASES[n] || Object.keys(STATE_CODES).find(k => k.toLowerCase() === n) ||
      Object.keys(STATE_CODES).find(k => k.toLowerCase().replace(/&/g, 'and') === n.replace(/&/g, 'and'));
    return canon ? STATE_CODES[canon] : '';
  }
  const stateName = (code) => Object.keys(STATE_CODES).find(k => STATE_CODES[k] === code) || '';

  const REASONS = ['Crossing the Threshold', 'Inter-State supply', 'Voluntary Basis', 'E-Commerce Operator',
    'Supplies through E-Commerce Operator', 'Liability to pay as recipient of goods or services',
    'Input Service Distributor only', 'Supplies on behalf of other taxable person', 'Transfer / Succession of business',
    'Change in constitution of business', 'Merger / Amalgamation', 'De-merger', 'Death of the Proprietor', 'Others'];

  const POSSESSION = ['Own', 'Leased', 'Rented', 'Consent', 'Shared', 'Others'];

  const ACTIVITIES = ['Bonded Warehouse', 'EOU / STP / EHTP', 'Export', 'Factory / Manufacturing', 'Import',
    'Supplier of Services', 'Leasing Business', 'Office / Sale Office', 'Recipient of Goods or Services',
    'Retail Business', 'Warehouse / Depot', 'Wholesale Business', 'Works Contract', 'Input Service Distributor (ISD)', 'Others'];

  const GENDERS = ['Male', 'Female', 'Others'];
  const ACCOUNT_TYPES = ['Savings', 'Current', 'Cash Credit', 'Overdraft', 'Others'];

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  const newAddress = () => ({
    building: '', floor: '', premises: '', road: '', locality: '', city: '', district: '', state: '', pin: '', landmark: '', country: 'India'
  });

  const newPerson = () => ({
    id: uid(), firstName: '', middleName: '', lastName: '', fatherFirst: '', fatherMiddle: '', fatherLast: '',
    dob: '', gender: '', mobile: '', email: '', telephone: '', designation: '', din: '', citizen: 'yes', pan: '', aadhaar: '',
    isSignatory: false, address: newAddress()
  });

  function newProfile(constitution) {
    const c = constitution || 'proprietorship';
    const p = {
      id: uid(), nickname: '', constitution: c, created: new Date().toISOString(), updated: new Date().toISOString(),
      status: 'registered', gstin: '',
      portal: { username: '', passwordEnc: null },
      tally: { company: '' },
      partA: { state: '', district: '', legalName: '', pan: '', email: '', mobile: '' },
      business: {
        tradeName: '', commencementDate: '', liabilityDate: '', reason: 'Voluntary Basis', composition: 'no', casual: 'no', rule14A: 'no',
        regNo: '', regDate: '', stateWard: '', commissionerate: '', division: '', range: ''
      },
      persons: [],
      ppob: {
        address: newAddress(), latitude: '', longitude: '', officeEmail: '', officePhone: '', officeMobile: '',
        possession: '', activities: []
      },
      goods: { hsn: ['', '', '', '', ''], sac: ['', '', '', '', ''] },
      stateInfo: { ptEC: '', ptRC: '', exciseLicense: '', exciseHolder: '' },
      bank: { accountNo: '', ifsc: '', accountType: '' },
      aadhaarAuth: 'yes',
      notes: ''
    };
    const n = CONSTITUTIONS[c].min;
    for (let i = 0; i < n; i++) p.persons.push(newPerson());
    p.persons[0].isSignatory = true;
    p.persons[0].designation = CONSTITUTIONS[c].designations[0];
    return p;
  }

  // Older/partial saved profiles get any missing keys filled in.
  function normalizeProfile(raw) {
    if (raw && !raw.status) raw = { ...raw, status: raw.gstin ? 'registered' : 'new' };
    const base = newProfile(raw && raw.constitution in CONSTITUTIONS ? raw.constitution : 'proprietorship');
    const merge = (a, b) => {
      if (Array.isArray(a)) return Array.isArray(b) ? b : a;
      if (a && typeof a === 'object') {
        const out = { ...a };
        if (b && typeof b === 'object') for (const k of Object.keys(b)) out[k] = k in a ? merge(a[k], b[k]) : b[k];
        return out;
      }
      return b === undefined || b === null ? a : b;
    };
    const p = merge(base, raw || {});
    p.persons = (p.persons && p.persons.length ? p.persons : base.persons).map(x => merge(newPerson(), x));
    p.persons.forEach(x => { if (!x.id) x.id = uid(); x.address = merge(newAddress(), x.address); });
    p.ppob.address = merge(newAddress(), p.ppob.address);
    while (p.goods.hsn.length < 5) p.goods.hsn.push('');
    while (p.goods.sac.length < 5) p.goods.sac.push('');
    if (!p.id) p.id = uid();
    return p;
  }

  const fullName = (x) => [x.firstName, x.middleName, x.lastName].filter(Boolean).join(' ').trim();
  const signatory = (p) => p.persons.find(x => x.isSignatory) || p.persons[0] || newPerson();

  // yyyy-mm-dd (stored) -> dd/mm/yyyy (portal)
  const toPortalDate = (s) => {
    if (!s) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  };

  /* ---------- Validation ---------- */
  const RX = {
    pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    mobile: /^[6-9]\d{9}$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
    pin: /^[1-9]\d{5}$/,
    din: /^\d{8}$/,
    aadhaar: /^[2-9]\d{11}$/,
    ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
    hsn: /^\d{4}(\d{2})?(\d{2})?$/,
    sac: /^99\d{4}$/,
    lat: /^-?\d{1,2}(\.\d+)?$/,
    lng: /^-?\d{1,3}(\.\d+)?$/,
    gstin: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
  };

  function validate(p) {
    const C = CONSTITUTIONS[p.constitution];
    const errs = []; // {path, msg, level:'error'|'warn'}
    const req = (path, v, label) => { if (!String(v || '').trim()) errs.push({ path, msg: `${label} is required`, level: 'error' }); };
    const fmt = (path, v, rx, msg) => { if (v && !rx.test(v)) errs.push({ path, msg, level: 'error' }); };

    fmt('gstin', p.gstin, RX.gstin, 'GSTIN must be 15 characters like 27AABCS1234K1Z5');
    if (p.gstin && RX.gstin.test(p.gstin) && p.partA.pan && p.gstin.slice(2, 12) !== p.partA.pan) {
      errs.push({ path: 'gstin', level: 'warn', msg: 'GSTIN does not contain the business PAN' });
    }
    if (p.status === 'registered') {
      req('gstin', p.gstin, 'GSTIN');
      req('portal.username', p.portal.username, 'GST portal username');
      if (!p.portal.passwordEnc) errs.push({ path: 'portal.password', level: 'warn', msg: 'GST portal password not saved (needed for automatic login)' });
      if (!p.partA.legalName && !p.nickname) errs.push({ path: 'partA.legalName', level: 'warn', msg: 'Add a name for this client' });
      return errs;
    }

    req('partA.state', p.partA.state, 'State');
    req('partA.district', p.partA.district, 'District');
    req('partA.legalName', p.partA.legalName, 'Legal name');
    req('partA.pan', p.partA.pan, 'PAN');
    fmt('partA.pan', p.partA.pan, RX.pan, 'PAN must look like ABCDE1234F');
    if (p.partA.pan && RX.pan.test(p.partA.pan) && p.partA.pan[3] !== C.panChar) {
      errs.push({ path: 'partA.pan', level: 'error', msg: `4th letter of PAN should be "${C.panChar}" for a ${C.label}` });
    }
    req('partA.email', p.partA.email, 'Email');
    fmt('partA.email', p.partA.email, RX.email, 'Email looks wrong');
    req('partA.mobile', p.partA.mobile, 'Mobile');
    fmt('partA.mobile', p.partA.mobile, RX.mobile, 'Mobile must be 10 digits starting 6–9');

    req('business.commencementDate', p.business.commencementDate, 'Date of commencement');
    req('business.reason', p.business.reason, 'Reason for registration');
    if (C.idPattern && p.business.regNo && !C.idPattern.test(p.business.regNo)) {
      errs.push({ path: 'business.regNo', level: 'error', msg: `${C.idLabel} format looks wrong (${C.idHint})` });
    }
    if (p.business.rule14A === 'yes') {
      if (p.aadhaarAuth !== 'yes') errs.push({ path: 'aadhaarAuth', level: 'error', msg: 'Rule 14A needs Aadhaar authentication – set it to Yes' });
      const sig = signatory(p);
      if (!String(sig.aadhaar || '').trim()) errs.push({ path: 'business.rule14A', level: 'error', msg: 'Rule 14A needs the authorised signatory\'s Aadhaar number' });
      if (!p.persons.some(x => String(x.aadhaar || '').trim() && (x !== sig || p.persons.length === 1))) errs.push({ path: 'business.rule14A', level: 'error', msg: 'Rule 14A needs the Aadhaar number of at least one promoter / partner' });
      if (p.business.composition === 'yes') errs.push({ path: 'business.rule14A', level: 'warn', msg: 'Rule 14A with composition – check eligibility' });
    }
    if ((p.constitution === 'llp' || p.constitution.endsWith('company')) && !p.business.regNo) {
      errs.push({ path: 'business.regNo', level: 'warn', msg: `${C.idLabel} is usually needed` });
    }

    if (p.persons.length < C.min) errs.push({ path: 'persons', level: 'error', msg: `At least ${C.min} ${C.min > 1 ? C.people.toLowerCase() : C.person.toLowerCase()} needed` });
    if (p.persons.length > C.max) errs.push({ path: 'persons', level: 'error', msg: `A ${C.label} has only ${C.max} ${C.person.toLowerCase()}` });
    if (!p.persons.some(x => x.isSignatory)) errs.push({ path: 'persons', level: 'error', msg: 'Mark one person as authorised signatory' });

    p.persons.forEach((x, i) => {
      const b = `persons.${i}.`;
      const who = `${C.person} ${i + 1}`;
      req(b + 'firstName', x.firstName, `${who}: first name`);
      req(b + 'fatherFirst', x.fatherFirst, `${who}: father's first name`);
      req(b + 'dob', x.dob, `${who}: date of birth`);
      req(b + 'gender', x.gender, `${who}: gender`);
      req(b + 'mobile', x.mobile, `${who}: mobile`);
      fmt(b + 'mobile', x.mobile, RX.mobile, `${who}: mobile must be 10 digits`);
      req(b + 'email', x.email, `${who}: email`);
      fmt(b + 'email', x.email, RX.email, `${who}: email looks wrong`);
      req(b + 'pan', x.pan, `${who}: PAN`);
      fmt(b + 'pan', x.pan, RX.pan, `${who}: PAN must look like ABCDE1234F`);
      if (x.pan && RX.pan.test(x.pan) && x.pan[3] !== 'P') errs.push({ path: b + 'pan', level: 'warn', msg: `${who}: personal PAN usually has "P" as 4th letter` });
      fmt(b + 'aadhaar', (x.aadhaar || '').replace(/\s/g, ''), RX.aadhaar, `${who}: Aadhaar must be 12 digits`);
      if (p.constitution.endsWith('company') || p.constitution === 'llp') {
        if (!x.din) errs.push({ path: b + 'din', level: 'warn', msg: `${who}: ${p.constitution === 'llp' ? 'DPIN/DIN' : 'DIN'} is usually needed` });
      }
      fmt(b + 'din', x.din, RX.din, `${who}: DIN must be 8 digits`);
      req(b + 'address.pin', x.address.pin, `${who}: PIN code`);
      fmt(b + 'address.pin', x.address.pin, RX.pin, `${who}: PIN code must be 6 digits`);
      req(b + 'address.city', x.address.city, `${who}: city/town`);
      req(b + 'address.building', x.address.building, `${who}: building/flat no.`);
    });

    const a = p.ppob.address;
    req('ppob.address.building', a.building, 'Business address: building/flat no.');
    req('ppob.address.city', a.city, 'Business address: city/town');
    req('ppob.address.pin', a.pin, 'Business address: PIN code');
    fmt('ppob.address.pin', a.pin, RX.pin, 'Business address: PIN code must be 6 digits');
    req('ppob.address.district', a.district, 'Business address: district');
    req('ppob.possession', p.ppob.possession, 'Nature of possession');
    if (!p.ppob.activities.length) errs.push({ path: 'ppob.activities', level: 'error', msg: 'Pick at least one business activity' });
    fmt('ppob.officeEmail', p.ppob.officeEmail, RX.email, 'Office email looks wrong');
    fmt('ppob.officeMobile', p.ppob.officeMobile, RX.mobile, 'Office mobile must be 10 digits');
    fmt('ppob.latitude', p.ppob.latitude, RX.lat, 'Latitude looks wrong');
    fmt('ppob.longitude', p.ppob.longitude, RX.lng, 'Longitude looks wrong');

    const hsn = p.goods.hsn.filter(Boolean), sac = p.goods.sac.filter(Boolean);
    if (!hsn.length && !sac.length) errs.push({ path: 'goods', level: 'error', msg: 'Add at least one HSN or SAC code' });
    p.goods.hsn.forEach((v, i) => fmt(`goods.hsn.${i}`, v, RX.hsn, `HSN ${i + 1} should be 4, 6 or 8 digits`));
    p.goods.sac.forEach((v, i) => fmt(`goods.sac.${i}`, v, RX.sac, `SAC ${i + 1} should be 6 digits starting 99`));
    fmt('bank.ifsc', p.bank.ifsc, RX.ifsc, 'IFSC looks wrong');
    return errs;
  }

  /* ---------- Documents to keep ready ---------- */
  function documents(p) {
    const C = CONSTITUTIONS[p.constitution];
    const d = [];
    if (p.constitution === 'proprietorship') d.push('PAN card of the proprietor');
    else d.push(`PAN card of the ${C.label.toLowerCase()}`);
    if (p.constitution === 'partnership') d.push('Partnership deed (PDF)');
    if (p.constitution === 'llp') d.push('LLP certificate of incorporation (and LLP agreement)');
    if (p.constitution.endsWith('company')) d.push('Certificate of incorporation from MCA');
    d.push(`Photograph of each ${C.person.toLowerCase()} and the authorised signatory (JPEG, max 100 KB)`);
    if (p.constitution !== 'proprietorship') {
      d.push(p.constitution.endsWith('company')
        ? 'Board resolution appointing the authorised signatory'
        : 'Letter of authorisation for the authorised signatory, signed by partners');
    }
    const pos = p.ppob.possession;
    d.push('Proof of business address: latest electricity bill, property tax receipt or municipal khata (PDF/JPEG, max 1 MB)');
    if (pos === 'Rented' || pos === 'Leased') d.push('Rent / lease agreement for the business premises');
    if (pos === 'Consent' || pos === 'Shared') d.push('Consent letter / NOC from the owner, with owner’s ID and electricity bill');
    if (p.bank.accountNo) d.push('Bank proof: cancelled cheque, passbook first page or statement');
    return d;
  }

  /* ---------- Portal sections ---------- */
  const SECTIONS = {
    partA: 'Part A – New registration', otp: 'OTP verification', business: 'Business details',
    promoter: 'Promoter / Partners', signatory: 'Authorised signatory', representative: 'Authorised representative',
    ppob: 'Principal place of business', apob: 'Additional places of business', goods: 'Goods and services',
    bank: 'Bank accounts', state: 'State specific information', aadhaar: 'Aadhaar authentication', verification: 'Verification'
  };
  const PERSON_SECTIONS = ['promoter', 'signatory', 'representative'];
  const ADDRESS_SECTIONS = ['promoter', 'signatory', 'ppob'];

  /* Field definitions used to recognise portal fields by their label.
     key: data path. ctx: sections where it applies. pat: all must match label. not: none may match.
     type: text | select | date | yesno | radio | check | multicheck | typeahead */
  const P = (key, ctx, pat, opt = {}) => ({ key, ctx, pat: [].concat(pat), not: [].concat(opt.not || []), type: opt.type || 'text', label: opt.label || key });

  const ADDR = [
    P('addr.premises', ADDRESS_SECTIONS, /premises|name of (the )?building/, { label: 'Name of premises / building' }),
    P('addr.building', ADDRESS_SECTIONS, /flat|building no|door no|house no|building number/, { not: /premises/, label: 'Building / flat no.' }),
    P('addr.floor', ADDRESS_SECTIONS, /floor/, { label: 'Floor no.' }),
    P('addr.road', ADDRESS_SECTIONS, /road|street/, { label: 'Road / street' }),
    P('addr.city', ADDRESS_SECTIONS, /city|town|village/, { label: 'City / town / village' }),
    P('addr.locality', ADDRESS_SECTIONS, /locality/, { not: /city|town|village/, label: 'Locality / sub-locality' }),
    P('addr.landmark', ADDRESS_SECTIONS, /landmark/, { label: 'Nearby landmark' }),
    P('addr.pin', ADDRESS_SECTIONS, /pin ?code|pincode|postal code|^pin\b/, { label: 'PIN code' }),
    P('addr.district', ADDRESS_SECTIONS, /district/, { type: 'select', label: 'District' }),
    P('addr.country', ['promoter', 'signatory'], /^country\b/, { type: 'select', label: 'Country' }),
    P('addr.state', ADDRESS_SECTIONS, /^state\b|state ?\/ ?ut|state name/, { not: /jurisdiction|specific|ward|excise/, type: 'select', label: 'State' })
  ];

  const PERSON = PERSON_SECTIONS;
  const FIELDS = [
    // Part A
    P('const:Taxpayer', ['partA'], /i am a|applicant type|type of taxpayer/, { type: 'select', label: 'I am a' }),
    P('p.partA.state', ['partA'], /state|union territory/, { type: 'select', label: 'State / UT' }),
    P('p.partA.district', ['partA'], /district/, { type: 'select', label: 'District' }),
    P('p.partA.legalName', ['partA'], /legal name/, { label: 'Legal name (as per PAN)' }),
    P('p.partA.pan', ['partA'], /permanent account number|\bpan\b/, { label: 'PAN' }),
    P('p.partA.email', ['partA'], /e-?mail/, { label: 'Email' }),
    P('p.partA.mobile', ['partA'], /mobile/, { label: 'Mobile' }),

    // Business details
    P('p.business.tradeName', ['business'], /trade name/, { label: 'Trade name' }),
    P('fn:constitution', ['business'], /constitution/, { type: 'select', label: 'Constitution of business' }),
    P('fn:commencement', ['business'], /commencement/, { type: 'date', label: 'Date of commencement' }),
    P('fn:liability', ['business'], /liability/, { not: /limited liability/, type: 'date', label: 'Date liability arises' }),
    P('p.business.reason', ['business'], /reason/, { type: 'select', label: 'Reason to obtain registration' }),
    P('p.business.rule14A', ['business', 'aadhaar', 'verification'], /14\s*-?\s*a\b|simplified registration/, { type: 'yesno', label: 'Opt for registration under Rule 14A' }),
    P('p.business.composition', ['business'], /composition/, { type: 'yesno', label: 'Opt for composition' }),
    P('p.business.casual', ['business'], /casual/, { type: 'yesno', label: 'Casual taxable person' }),
    P('fn:regType', ['business'], /registration type|type of registration|existing registration/, { type: 'select', label: 'Existing registration type' }),
    P('p.business.regNo', ['business'], /registration n(o|umber)|\bcin\b|llpin|identification number/, { not: /type|date|permanent/, label: 'Registration no. (CIN / LLPIN / firm)' }),
    P('fn:regDate', ['business'], /date of (registration|incorporation)/, { type: 'date', label: 'Date of registration / incorporation' }),
    P('p.business.stateWard', ['business', 'ppob'], /ward|circle|sector|charge/, { type: 'select', label: 'State jurisdiction (ward/circle)' }),
    P('p.business.commissionerate', ['business', 'ppob'], /commissionerate/, { type: 'select', label: 'Centre: commissionerate' }),
    P('p.business.division', ['business', 'ppob'], /division/, { type: 'select', label: 'Centre: division' }),
    P('p.business.range', ['business', 'ppob'], /^range\b|range code|\brange$/, { type: 'select', label: 'Centre: range' }),

    // People
    P('person.fatherFirst', PERSON, [/father/, /first/], { label: "Father's first name" }),
    P('person.fatherMiddle', PERSON, [/father/, /middle/], { label: "Father's middle name" }),
    P('person.fatherLast', PERSON, [/father/, /last|sur ?name/], { label: "Father's last name" }),
    P('person.firstName', PERSON, /first name/, { not: /father/, label: 'First name' }),
    P('person.middleName', PERSON, /middle name/, { not: /father/, label: 'Middle name' }),
    P('person.lastName', PERSON, /last name|surname/, { not: /father/, label: 'Last name' }),
    P('fn:dob', PERSON, /date of birth|\bdob\b/, { type: 'date', label: 'Date of birth' }),
    P('person.gender', PERSON, /gender/, { type: 'radio', label: 'Gender' }),
    P('person.mobile', PERSON, /mobile/, { label: 'Mobile' }),
    P('person.email', PERSON, /e-?mail/, { label: 'Email' }),
    P('person.telephone', PERSON, /telephone|std/, { label: 'Telephone (with STD)' }),
    P('person.designation', PERSON, /designation|status/, { not: /citizen/, label: 'Designation / status' }),
    P('person.din', PERSON, /\bdin\b|director identification|dpin/, { label: 'DIN / DPIN' }),
    P('person.citizen', PERSON, /citizen/, { type: 'yesno', label: 'Citizen of India' }),
    P('person.pan', PERSON, /permanent account number|\bpan\b/, { label: 'PAN' }),
    P('fn:aadhaar', PERSON, /aadhaar/, { not: /authentication|consent/, label: 'Aadhaar number' }),
    P('person.isSignatory', ['promoter'], /also authori[sz]ed signatory|authori[sz]ed signatory/, { type: 'check', label: 'Also authorised signatory' }),
    P('const:true', ['signatory'], /primary authori[sz]ed signatory/, { type: 'check', label: 'Primary authorised signatory' }),

    // Principal place of business (non-address)
    P('p.ppob.latitude', ['ppob'], /latitude/, { label: 'Latitude' }),
    P('p.ppob.longitude', ['ppob'], /longitude/, { label: 'Longitude' }),
    P('p.ppob.officeEmail', ['ppob'], /e-?mail/, { label: 'Office email' }),
    P('p.ppob.officePhone', ['ppob'], /telephone|std/, { label: 'Office telephone' }),
    P('p.ppob.officeMobile', ['ppob'], /mobile/, { label: 'Office mobile' }),
    P('p.ppob.possession', ['ppob'], /possession/, { type: 'select', label: 'Nature of possession' }),
    P('p.ppob.activities', ['ppob'], /./, { type: 'multicheck', label: 'Business activities' }),

    // Goods & services
    P('fn:hsn', ['goods'], /hsn/, { type: 'typeahead', label: 'HSN code (first)' }),
    P('fn:sac', ['goods'], /\bsac\b|service/, { not: /hsn/, type: 'typeahead', label: 'SAC code (first)' }),

    // Bank
    P('p.bank.accountNo', ['bank'], /account number|account no/, { label: 'Account number' }),
    P('p.bank.ifsc', ['bank'], /ifsc/, { label: 'IFSC' }),
    P('p.bank.accountType', ['bank'], /type of account|account type/, { type: 'select', label: 'Account type' }),

    // State specific
    P('p.stateInfo.ptEC', ['state'], /enrol?ment certificate|\bec\b/, { label: 'Professional tax EC no.' }),
    P('p.stateInfo.ptRC', ['state'], /registration certificate|\brc\b/, { label: 'Professional tax RC no.' }),
    P('p.stateInfo.exciseHolder', ['state'], /in whose name|licen[cs]e holder/, { label: 'Excise licence holder' }),
    P('p.stateInfo.exciseLicense', ['state'], /excise|licen[cs]e/, { label: 'State excise licence no.' }),

    // Aadhaar / verification
    P('p.aadhaarAuth', ['aadhaar'], /aadhaar/, { type: 'yesno', label: 'Opt for Aadhaar authentication' }),
    P('fn:signatoryName', ['verification'], /authori[sz]ed signatory|name of/, { type: 'select', label: 'Name of authorised signatory' }),
    P('p.ppob.address.city', ['verification'], /^place\b/, { label: 'Place' }),

    ...ADDR
  ];

  // Resolve a field's value for the given profile + section + chosen person.
  function resolve(key, p, ctx, personIdx) {
    const C = CONSTITUTIONS[p.constitution];
    const person = ctx === 'signatory' && (personIdx == null || personIdx < 0)
      ? signatory(p) : (p.persons[personIdx || 0] || p.persons[0] || newPerson());
    if (key.startsWith('const:')) { const v = key.slice(6); return v === 'true' ? true : v; }
    if (key.startsWith('fn:')) {
      switch (key.slice(3)) {
        case 'constitution': return C.portal[0];
        case 'commencement': return toPortalDate(p.business.commencementDate);
        case 'liability': return toPortalDate(p.business.liabilityDate || p.business.commencementDate);
        case 'regType': return p.business.regNo ? (C.idType || '') : '';
        case 'regDate': return toPortalDate(p.business.regDate);
        case 'dob': return toPortalDate(person.dob);
        case 'aadhaar': return (person.aadhaar || '').replace(/\s/g, '');
        case 'hsn': return p.goods.hsn.find(Boolean) || '';
        case 'sac': return p.goods.sac.find(Boolean) || '';
        case 'signatoryName': return fullName(signatory(p));
      }
      return '';
    }
    let base, path;
    if (key.startsWith('p.')) { base = p; path = key.slice(2); }
    else if (key.startsWith('person.')) { base = person; path = key.slice(7); }
    else if (key.startsWith('addr.')) { base = ctx === 'ppob' ? p.ppob.address : person.address; path = key.slice(5); }
    else return '';
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), base);
  }

  // Everything worth copying by hand for a section (the panel's "Values" list).
  function valuesFor(p, ctx, personIdx) {
    const out = [];
    const seen = new Set();
    for (const f of FIELDS) {
      if (!f.ctx.includes(ctx) || f.key.startsWith('const:')) continue;
      let v = resolve(f.key, p, ctx, personIdx);
      if (Array.isArray(v)) v = v.join(', ');
      if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
      if (v === 'yes') v = 'Yes'; else if (v === 'no') v = 'No';
      if (!v || seen.has(f.label)) continue;
      seen.add(f.label);
      out.push({ label: f.label, value: String(v) });
    }
    if (ctx === 'goods') {
      p.goods.hsn.filter(Boolean).forEach((v, i) => out.push({ label: `HSN ${i + 1}`, value: v }));
      p.goods.sac.filter(Boolean).forEach((v, i) => out.push({ label: `SAC ${i + 1}`, value: v }));
    }
    return out;
  }

  root.GSTR = {
    CONSTITUTIONS, STATES, STATE_CODES, stateCode, stateName, REASONS, POSSESSION, ACTIVITIES, GENDERS, ACCOUNT_TYPES, SECTIONS, PERSON_SECTIONS,
    FIELDS, RX, newProfile, newPerson, newAddress, normalizeProfile, validate, documents, resolve, valuesFor,
    fullName, signatory, toPortalDate, uid,
    KEYS: { profiles: 'gstf_profiles', mappings: 'gstf_mappings', settings: 'gstf_settings', queue: 'gstf_queue',
      recipes: 'gstf_recipes', downloads: 'gstf_download_log' },
    displayName: (p) => p.nickname || p.business.tradeName || p.partA.legalName || p.gstin || 'Untitled client',
    MONTHS: ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March']
  };
})(typeof window !== 'undefined' ? window : globalThis);
