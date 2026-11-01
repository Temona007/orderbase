(function () {
  const KEY = "klario-demo-v1";
  const AUTH = "klario-auth";
  const VIEWS = ["overview", "queue", "order", "products", "customers", "companies", "setup", "bc", "protection", "plan"];
  const HASH = {
    overview: "overview",
    queue: "queue",
    order: "order",
    products: "products",
    customers: "customers",
    companies: "companies",
    setup: "setup",
    bc: "business-central",
    protection: "protection",
    plan: "plan",
  };
  const FILTERS = [
    ["all", "All"],
    ["review", "Needs review"],
    ["duplicate", "Duplicates"],
    ["ready", "Ready"],
    ["posted", "Posted"],
  ];
  const PLANS = [
    { id: "Entry", price: "€950", period: "per month", limit: 200, points: ["1 company included", "PDF, Excel, and scans", "Catalog and duplicate checks", "Business Central posting", "Frankfurt region hosting"] },
    { id: "Professional", price: "€1,450", period: "per month", limit: 800, points: ["Up to 5 companies", "Guided company setup", "Full audit log", "Role-based access", "Frankfurt region hosting"] },
    { id: "Enterprise", price: "Custom", period: "annual agreement", limit: null, points: ["Unlimited companies", "Custom document volume", "Retention to match your policy", "Security review on request", "Frankfurt region hosting"] },
  ];
  const PACKS = [
    { id: "industrial", label: "Industrial supplies", detail: "Seals, fittings, valves", from: "hartmann" },
    { id: "tools", label: "Fluid parts", detail: "Pumps, valves, sensors", from: "bergmann" },
    { id: "packaging", label: "Packaging", detail: "Cartons, tape, film", from: "keller" },
  ];
  const SETUP_STEPS = ["Company", "Connection", "Catalog", "Channels", "Team", "Review"];

  let anim = true;
  let DB = loadDB();
  const state = {
    authed: sessionStorage.getItem(AUTH) === "1",
    view: "overview",
    companyId: "hartmann",
    orderId: null,
    filter: "all",
    query: "",
    menu: null,
    toasts: [],
    setup: defaultSetup(),
    busy: null,
    armed: false,
  };

  function defaultSetup() {
    return {
      step: 0,
      name: "Demo Stahl GmbH",
      city: "Hamburg",
      vat: "DE123456789",
      env: "Sandbox",
      bcCompany: "Demo Stahl GmbH",
      bcOk: false,
      bcCheckedName: "",
      catalog: "",
      pdf: true,
      excel: true,
      reviewer: "Alex Berger",
      error: "",
      createdId: null,
    };
  }

  function loadDB() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1) return parsed;
      }
    } catch (err) { /* keep the seed */ }
    return structuredClone(window.KLARIO_SEED);
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (err) { /* demo only */ }
  }

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function money(value) {
    if (value == null || value === "" || Number.isNaN(Number(value))) return "—";
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }).format(Number(value));
  }
  function cents(value) { return Math.round(Number(value) * 100); }
  function when(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    return date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function day(iso) {
    if (!iso) return "—";
    const date = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function pct(value) { return Math.round(Number(value) * 100); }
  function company() { return DB.companies.find(function (item) { return item.id === state.companyId; }) || DB.companies[0]; }
  function orders() { return DB.orders[state.companyId] || []; }
  function products() { return DB.catalog[state.companyId] || []; }
  function customers() { return DB.customers[state.companyId] || []; }
  function userName() { return (company().users[0] && company().users[0].name) || "Reviewer"; }
  function initials(name) {
    return name.split(/\s+/).slice(0, 2).map(function (part) { return part[0] || ""; }).join("").toUpperCase();
  }
  function productBySku(sku) { return products().find(function (item) { return item.sku === sku; }); }
  function customerById(id) { return customers().find(function (item) { return item.id === id; }); }
  function currentOrder() { return orders().find(function (item) { return item.id === state.orderId; }); }

  function analyze(order) {
    if (!order || order.status === "extracting") {
      return { blocks: [], checks: [], pending: true };
    }
    const blocks = [];
    const customerOk = Boolean(order.customer.matchId) && (order.customer.confirmed || order.customer.confidence >= 0.9);
    if (!customerOk) {
      blocks.push({ type: "customer", text: "The customer on the document is not confirmed against master data." });
    }
    if (order.status !== "posted" && order.status !== "discarded" && order.duplicateOf && !order.duplicateCleared) {
      blocks.push({
        type: "duplicate",
        text: "Purchase order " + order.poNumber + " already exists on " + order.duplicateOf + " for the same customer.",
      });
    }
    order.lines.forEach(function (line, index) {
      const prod = line.catalogSku ? productBySku(line.catalogSku) : null;
      const label = "Line " + (index + 1);
      if (line.qty == null || Number(line.qty) <= 0 || Number.isNaN(Number(line.qty))) {
        blocks.push({ type: "qty", line: index, text: label + " is missing a quantity." });
      }
      if (!prod) {
        blocks.push({ type: "sku", line: index, text: label + " item " + line.extractedSku + " is not in the product catalog." });
      } else if (cents(line.price) !== cents(prod.price) && !line.priceDecision) {
        blocks.push({
          type: "price",
          line: index,
          text: label + " shows " + money(line.price) + ". The catalog price for " + prod.name + " is " + money(prod.price) + ".",
        });
      }
    });
    const priceOk = order.lines.every(function (line) {
      const prod = line.catalogSku ? productBySku(line.catalogSku) : null;
      if (!prod) return false;
      return Boolean(line.priceDecision) || cents(line.price) === cents(prod.price);
    });
    return {
      blocks: blocks,
      pending: false,
      checks: [
        { ok: customerOk, label: "Customer matched" },
        { ok: order.lines.every(function (line) { return Boolean(line.catalogSku && productBySku(line.catalogSku)); }), label: "Items found in catalog" },
        { ok: order.lines.every(function (line) { return Number(line.qty) > 0; }), label: "Quantities complete" },
        { ok: priceOk, label: "Prices aligned" },
        { ok: !order.duplicateOf || order.duplicateCleared || order.status === "posted" || order.status === "discarded", label: "No duplicate" },
      ],
    };
  }

  function phaseOf(order, blocks) {
    if (!order) return "review";
    if (order.status === "posted" || order.status === "discarded" || order.status === "extracting") return order.status;
    const hard = (blocks || []).filter(function (block) { return block.type !== "duplicate"; });
    if (hard.length) return "review";
    if ((blocks || []).some(function (block) { return block.type === "duplicate"; })) return "duplicate";
    return "ready";
  }

  function decorate(order) {
    const report = analyze(order);
    return { order: order, report: report, phase: phaseOf(order, report.blocks) };
  }

  function decorated() {
    return orders().map(decorate).sort(function (a, b) {
      const rank = { extracting: 0, review: 1, duplicate: 2, ready: 3, posted: 4, discarded: 5 };
      if (rank[a.phase] !== rank[b.phase]) return rank[a.phase] - rank[b.phase];
      return new Date(b.order.receivedAt) - new Date(a.order.receivedAt);
    });
  }

  function attentionCount() {
    return decorated().filter(function (item) {
      return item.phase === "review" || item.phase === "duplicate" || item.phase === "extracting";
    }).length;
  }

  function lowest(order) {
    const values = [order.customer.confidence].concat(order.lines.map(function (line) { return line.confidence; }));
    return Math.min.apply(null, values);
  }

  function orderTotal(order) {
    return order.lines.reduce(function (sum, line) {
      const qty = Number(line.qty);
      const price = Number(line.price);
      if (!(qty > 0) || Number.isNaN(price)) return sum;
      return sum + qty * price;
    }, 0);
  }

  function phaseLabel(phase) {
    return {
      extracting: "Reading",
      review: "Needs review",
      duplicate: "Duplicate",
      ready: "Ready",
      posted: "Posted",
      discarded: "Discarded",
    }[phase] || phase;
  }

  function audit(text, tone) {
    DB.audit.unshift({
      id: uid(),
      companyId: state.companyId,
      at: new Date().toISOString(),
      tone: tone || "info",
      text: text,
    });
  }

  function toast(text) {
    const id = uid();
    state.toasts.push({ id: id, text: text });
    paintToasts();
    setTimeout(function () {
      state.toasts = state.toasts.filter(function (item) { return item.id !== id; });
      paintToasts();
    }, 3400);
  }

  function paintToasts() {
    const box = document.getElementById("toasts");
    if (!box) return;
    box.innerHTML = state.toasts.map(function (item) {
      return '<div class="toast">' + esc(item.text) + "</div>";
    }).join("");
  }

  function hashFor(view, orderId) {
    if (view === "order") return "#/order/" + encodeURIComponent(orderId || state.orderId || "");
    return "#/" + (HASH[view] || "overview");
  }

  function applyHash() {
    const parts = (location.hash || "#/overview").replace(/^#\/?/, "").split("/");
    const slug = parts[0] || "overview";
    const entry = Object.keys(HASH).find(function (key) { return HASH[key] === slug; });
    if (entry === "order" && parts[1]) {
      state.view = "order";
      state.orderId = decodeURIComponent(parts[1]);
      return;
    }
    state.view = VIEWS.indexOf(entry) >= 0 ? entry : "overview";
  }

  function navigate(view, extra) {
    extra = extra || {};
    if (view !== state.view) state.query = "";
    state.view = view;
    if (extra.orderId) state.orderId = extra.orderId;
    state.menu = null;
    const next = hashFor(view, state.orderId);
    anim = true;
    if (location.hash !== next) {
      if (extra.replace) {
        history.replaceState(null, "", next);
        render();
      } else location.hash = next;
    } else render();
  }

  function armExtractor() {
    if (state.armed) return;
    state.armed = true;
    setTimeout(function () {
      let changed = false;
      Object.keys(DB.orders).forEach(function (companyId) {
        (DB.orders[companyId] || []).forEach(function (order) {
          if (order.status !== "extracting") return;
          order.status = "active";
          changed = true;
          DB.audit.unshift({
            id: uid(),
            companyId: companyId,
            at: new Date().toISOString(),
            tone: "info",
            text: order.id + " finished reading and is ready to post.",
          });
        });
      });
      if (!changed) return;
      persist();
      if (state.authed) {
        toast("Reading finished. The document is ready to post.");
        render();
      }
    }, 1700);
  }

  function enter() {
    sessionStorage.setItem(AUTH, "1");
    state.authed = true;
    audit(userName() + " opened the workspace.", "info");
    persist();
    armExtractor();
    if (!location.hash || location.hash === "#") navigate("overview", { replace: true });
    else {
      applyHash();
      anim = true;
      render();
    }
  }

  function lock() {
    sessionStorage.removeItem(AUTH);
    state.authed = false;
    state.menu = null;
    anim = true;
    render();
  }

  function captureSetup() {
    const map = { "co-name": "name", "co-city": "city", "co-vat": "vat", "co-bc": "bcCompany", "co-reviewer": "reviewer" };
    Object.keys(map).forEach(function (id) {
      const el = document.getElementById(id);
      if (el) state.setup[map[id]] = el.value.trim();
    });
    const env = document.getElementById("co-env");
    if (env) state.setup.env = env.value;
  }

  function postingPrice(line) {
    const prod = line.catalogSku ? productBySku(line.catalogSku) : null;
    if (line.priceDecision === "catalog" && prod) return prod.price;
    return line.price;
  }

  function approve(order) {
    const view = decorate(order);
    if (view.phase !== "ready" || state.busy) return;
    state.busy = order.id;
    render();
    setTimeout(function () {
      const fresh = orders().find(function (item) { return item.id === order.id; });
      if (!fresh || phaseOf(fresh, analyze(fresh).blocks) !== "ready") {
        state.busy = null;
        render();
        return;
      }
      const number = "SO-" + DB.seq;
      DB.seq += 1;
      fresh.status = "posted";
      fresh.bcSalesOrder = number;
      fresh.postedAt = new Date().toISOString();
      company().volumeUsed += 1;
      audit(userName() + " approved " + fresh.id + ". Sales order " + number + " was created in Business Central.", "ok");
      persist();
      state.busy = null;
      toast("Sales order " + number + " created in Business Central.");
      render();
    }, 800);
  }

  function createCompany() {
    if (state.setup._creating) return;
    state.setup._creating = true;
    const draft = state.setup;
    const pack = PACKS.find(function (item) { return item.id === draft.catalog; });
    const id = "co" + Math.floor(1000 + Math.random() * 9000);
    const sourceProducts = structuredClone(DB.catalog[pack.from] || []);
    const customerId = id + "-c1";
    DB.companies.push({
      id: id,
      name: draft.name,
      city: draft.city,
      vat: draft.vat.replace(/\s/g, "").toUpperCase(),
      plan: "Entry",
      volumeUsed: 1,
      volumeLimit: 200,
      bc: {
        connected: true,
        environment: draft.env,
        companyName: draft.bcCompany,
        lastSync: new Date().toISOString(),
      },
      users: [
        { name: draft.reviewer, role: "Admin" },
      ],
      channels: { pdf: draft.pdf, excel: draft.excel },
    });
    DB.catalog[id] = sourceProducts;
    DB.customers[id] = [{
      id: customerId,
      no: "C-10001",
      name: "Feldmann Fertigung GmbH",
      city: "Hannover",
      terms: "Net 30 days",
    }];
    const first = sourceProducts[0];
    const second = sourceProducts[1] || sourceProducts[0];
    const kind = draft.pdf ? "PDF" : "Excel";
    DB.orders[id] = [{
      id: "ORD-" + id.slice(2),
      status: "active",
      source: {
        kind: kind,
        file: kind === "PDF" ? "PO-Feldmann-1001.pdf" : "Feldmann-1001.xlsx",
        detail: kind === "PDF" ? "1 page" : "1 sheet",
      },
      receivedAt: new Date().toISOString(),
      customer: {
        extracted: "Feldmann Fertigung GmbH",
        extractedCity: "Hannover",
        confidence: 0.97,
        matchId: customerId,
        confirmed: true,
        candidates: [],
      },
      poNumber: "FF-1001",
      delivery: "2026-11-20",
      duplicateOf: null,
      duplicateCleared: false,
      bcSalesOrder: null,
      postedAt: null,
      lines: [first, second].filter(Boolean).map(function (prod, index) {
        const qty = index === 0 ? 4 : 10;
        return {
          extractedSku: prod.sku,
          extractedName: prod.name,
          catalogSku: prod.sku,
          qty: qty,
          extractedQty: qty,
          price: prod.price,
          extractedPrice: prod.price,
          confidence: 0.98,
          priceDecision: null,
          suggestions: [],
          wasUnknown: false,
        };
      }),
    }];
    DB.audit.unshift({
      id: uid(),
      companyId: id,
      at: new Date().toISOString(),
      tone: "ok",
      text: "Workspace created for " + draft.name + ". A sample document is ready to review.",
    });
    persist();
    state.setup.createdId = id;
    state.setup.step = 6;
    state.setup.error = "";
    render();
  }

  function setupNext() {
    const draft = state.setup;
    draft.error = "";
    if (draft.step === 0) {
      if (!draft.name || !draft.city || !draft.vat) {
        draft.error = "Add the company name, city, and VAT ID.";
        render();
        return;
      }
      const vat = draft.vat.replace(/\s/g, "").toUpperCase();
      if (!/^DE\d{9}$/.test(vat)) {
        draft.error = "Use a German VAT ID with DE and 9 digits.";
        render();
        return;
      }
      draft.vat = vat;
    }
    if (draft.step === 1) {
      if (!draft.bcCompany) {
        draft.error = "Add the Business Central company name.";
        render();
        return;
      }
      if (draft.bcCompany !== draft.bcCheckedName) draft.bcOk = false;
      if (!draft.bcOk) {
        draft.error = "Test the Business Central connection to continue.";
        render();
        return;
      }
    }
    if (draft.step === 2 && !draft.catalog) {
      draft.error = "Choose a catalog to start from.";
      render();
      return;
    }
    if (draft.step === 3 && !draft.pdf && !draft.excel) {
      draft.error = "Keep at least one document channel.";
      render();
      return;
    }
    if (draft.step === 4 && !draft.reviewer) {
      draft.error = "Add a reviewer name.";
      render();
      return;
    }
    if (draft.step === 5) {
      createCompany();
      return;
    }
    draft.step += 1;
    anim = true;
    render();
  }

  function icon(name) {
    const paths = {
      grid: '<rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/>',
      docs: '<path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.8V9h5"/>',
      box: '<path d="M3.5 8 12 4l8.5 4L12 12 3.5 8z"/><path d="M3.5 8v8L12 20l8.5-4V8"/><path d="M12 12v8"/>',
      people: '<path d="M8 13a3.2 3.2 0 1 0-3.2-3.2A3.2 3.2 0 0 0 8 13z"/><path d="M2.8 19.2a5.2 5.2 0 0 1 10.4 0"/><path d="M16 12.2a2.6 2.6 0 1 0-1.6-4.7"/><path d="M16.2 14.2a4.6 4.6 0 0 1 4.8 5"/>',
      layers: '<path d="M12 4 3.5 8.5 12 13l8.5-4.5L12 4z"/><path d="M3.5 12 12 16.5 20.5 12"/><path d="M3.5 15.5 12 20l8.5-4.5"/>',
      wand: '<path d="M4 20 15 9"/><path d="M13 7l2-2 4 4-2 2"/><path d="M14 4v2M18 8h2M5 4v3M4 5.5h3"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.2.6l2-2a5 5 0 0 0-7-7l-1.2 1.1"/><path d="M14 11a5 5 0 0 0-7.2-.6l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
      shield: '<path d="M12 3.5 19 6v6.2c0 4.2-2.8 6.8-7 8.3-4.2-1.5-7-4.1-7-8.3V6l7-2.5z"/>',
      card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
    };
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || "") + "</svg>";
  }

  function mark() {
    return '<span class="mark" aria-hidden="true"><svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="#137a5e"/><path d="M8 17.2 13.2 22 24 10" fill="none" stroke="#f3f7f4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
  }

  function pill(phase) {
    return '<span class="pill ' + phase + '"><i></i>' + esc(phaseLabel(phase)) + "</span>";
  }

  function confBar(value) {
    if (value == null || Number.isNaN(value)) return '<span class="conf"><span style="width:18%"></span></span>';
    const level = value < 0.7 ? "low" : value < 0.9 ? "mid" : "";
    return '<span class="conf ' + level + '" title="Lowest match ' + pct(value) + '%"><span style="width:' + pct(value) + '%"></span></span>';
  }

  function kindClass(kind) {
    if (kind === "Excel") return "excel";
    if (kind === "Scan") return "scan";
    return "pdf";
  }

  function renderLogin() {
    return ''
      + '<main class="login">'
      + '<section class="brand-panel">'
      + '<div class="brand-top">' + mark() + '<div class="word">Klario<small>Order intake</small></div></div>'
      + '<div class="brand-copy">'
      + '<p class="eyebrow">For German B2B teams</p>'
      + "<h1>Documents become sales orders.</h1>"
      + "<p class=\"lede\">Klario reads purchase orders, checks them against your catalog, and posts approved orders to Microsoft Dynamics 365 Business Central.</p>"
      + "<ul class=\"points\">"
      + "<li><span class=\"tick\" aria-hidden=\"true\">✓</span><span>Reads PDF files, Excel workbooks, and scans.</span></li>"
      + "<li><span class=\"tick\" aria-hidden=\"true\">✓</span><span>Flags price gaps, missing fields, unknown items, and duplicates.</span></li>"
      + "<li><span class=\"tick\" aria-hidden=\"true\">✓</span><span>A person approves the order before it is created in Business Central.</span></li>"
      + "</ul>"
      + '<div class="brand-foot"><div><strong>EU hosting</strong>Frankfurt region</div><div><strong>Separate companies</strong>Own catalog and documents</div><div><strong>Human approval</strong>Nothing posts on its own</div></div>'
      + "</div></section>"
      + '<section class="form-panel"><div class="form-card">'
      + mark()
      + "<h2>Workspace</h2><p class=\"sub\">Sample access is filled in.</p>"
      + '<form id="gate" autocomplete="off">'
      + '<label class="field"><span>Workspace</span><input class="secret" readonly tabindex="-1" value="********" aria-label="Workspace, filled in" /></label>'
      + '<label class="field"><span>Access key</span><input class="secret" readonly tabindex="-1" value="********" aria-label="Access key, filled in" /></label>'
      + '<button class="btn btn-primary btn-block" type="submit" autofocus>Enter workspace</button>'
      + "</form>"
      + '<p class="form-note">Filled in for this demonstration. Continue to open the sample workspace.</p>'
      + '<p class="legal">Data stays in this browser. Hosting story: Frankfurt, EU only.</p>'
      + "</div></section></main>"
      + toastsHtml();
  }

  function renderShell(body) {
    const co = company();
    const nav = [
      ["Operate", [["overview", "Overview", "grid"], ["queue", "Queue", "docs"]]],
      ["Master data", [["products", "Products", "box"], ["customers", "Customers", "people"]]],
      ["Workspace", [["companies", "Companies", "layers"], ["setup", "Guided setup", "wand"], ["bc", "Business Central", "link"], ["protection", "Protection", "shield"], ["plan", "Subscription", "card"]]],
    ];
    const titles = {
      overview: "Overview",
      queue: "Document queue",
      order: "Review",
      products: "Product catalog",
      customers: "Customers",
      companies: "Companies",
      setup: "Guided setup",
      bc: "Business Central",
      protection: "Protection",
      plan: "Subscription",
    };
    const waiting = attentionCount();
    return ''
      + '<a class="skip" href="#content">Skip to content</a>'
      + '<div class="shell"><aside class="sidebar">'
      + '<div class="side-brand">' + mark() + '<div><div class="word">Klario</div><div class="side-co">' + esc(co.name) + "</div></div></div>"
      + nav.map(function (group) {
        return '<div class="nav-label">' + group[0] + "</div>" + group[1].map(function (item) {
          const active = state.view === item[0] ? " active" : "";
          const badge = item[0] === "queue" && waiting ? '<span class="badge">' + waiting + "</span>" : "";
          return '<button class="nav-btn' + active + '" data-act="nav" data-view="' + item[0] + '" aria-current="' + (active ? "page" : "false") + '">'
            + icon(item[2]) + '<span class="grow">' + item[1] + "</span>" + badge + "</button>";
        }).join("");
      }).join("")
      + '<div class="side-foot"><div>Frankfurt region<br>Sample data · separate per company</div>'
      + '<button class="lock" data-act="lock">Lock workspace</button></div>'
      + "</aside><div class=\"main\">"
      + '<header class="topbar"><div class="top-title">' + esc(titles[state.view] || "Klario") + "</div>"
      + '<div class="top-actions"><span class="sample-chip">Sample data</span>'
      + '<div class="switcher"><button class="switcher-btn" data-act="menu" aria-haspopup="listbox" aria-expanded="' + (state.menu === "company") + '">'
      + '<span class="avatar">' + esc(initials(co.name)) + "</span><span>" + esc(co.name) + "</span></button>"
      + (state.menu === "company" ? '<div class="menu" role="listbox">' + DB.companies.map(function (item) {
        return '<button class="menu-item' + (item.id === co.id ? " on" : "") + '" data-act="switch" data-id="' + esc(item.id) + '"><span>' + esc(item.name) + "<small>" + esc(item.city) + "</small></span><span>" + (item.id === co.id ? "●" : "") + "</span></button>";
      }).join("") + "</div>" : "")
      + '</div><div class="userchip"><span class="avatar">' + esc(initials(userName())) + "</span>" + esc(userName()) + "</div></div></header>"
      + '<div class="content" id="content"><div class="page' + (anim ? " anim" : "") + '">' + body + "</div></div></div></div>"
      + toastsHtml();
  }

  function toastsHtml() {
    return '<div id="toasts" class="toasts" aria-live="polite">' + state.toasts.map(function (item) {
      return '<div class="toast">' + esc(item.text) + "</div>";
    }).join("") + "</div>";
  }

  function renderOverview() {
    const rows = decorated();
    const waiting = rows.filter(function (item) { return item.phase === "review" || item.phase === "duplicate" || item.phase === "extracting"; });
    const ready = rows.filter(function (item) { return item.phase === "ready"; }).length;
    const posted = rows.filter(function (item) { return item.phase === "posted"; }).length;
    const hour = new Date().getHours();
    const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const kinds = ["PDF", "Excel", "Scan"];
    const counts = kinds.map(function (kind) {
      return rows.filter(function (item) { return item.order.source.kind === kind; }).length;
    });
    const max = Math.max.apply(null, counts.concat([1]));
    const attention = waiting.slice(0, 5);
    const recent = DB.audit.filter(function (item) { return item.companyId === state.companyId; }).slice(0, 5);
    return ''
      + '<div class="page-head"><div><h1>' + hello + ", " + esc(userName().split(" ")[0]) + ".</h1>"
      + "<p>" + (waiting.length ? waiting.length + " document" + (waiting.length === 1 ? "" : "s") + " need a decision before posting." : "Nothing is waiting. New documents will land in the queue.") + "</p></div>"
      + '<button class="btn btn-primary" data-act="nav" data-view="queue">Open queue</button></div>'
      + '<section class="stats stagger">'
      + stat(waiting.length, "Need a decision")
      + stat(ready, "Ready to post")
      + stat(posted, "Posted")
      + stat(rows.length, "In this workspace")
      + "</section>"
      + '<section class="split"><article class="card"><div class="card-h"><h2>Needs attention</h2><button class="linkish" data-act="nav" data-view="queue">View queue</button></div>'
      + (attention.length ? attention.map(function (item) {
        return '<button class="row-link" data-act="open" data-id="' + esc(item.order.id) + '"><span class="kind ' + kindClass(item.order.source.kind) + '">' + esc(item.order.source.kind === "Excel" ? "XLS" : item.order.source.kind === "Scan" ? "SCAN" : "PDF") + "</span><span class=\"grow\"><strong>" + esc(item.order.customer.extracted) + "</strong><br><small class=\"ellipsis\">" + esc(item.order.id) + " · " + esc(item.order.poNumber) + "</small></span>" + pill(item.phase) + "</button>";
      }).join("") : '<p class="empty">The queue is clear.</p>')
      + '</article><div class="stack">'
      + '<article class="card"><div class="card-h"><h2>Document channels</h2></div><div class="bars">'
      + kinds.map(function (kind, index) {
        const klass = index === 1 ? "" : index === 2 ? "info" : "warn";
        return '<div class="bar-row"><span>' + kind + '</span><div class="meter ' + klass + '"><span style="width:' + Math.round((counts[index] / max) * 100) + '%"></span></div><b>' + counts[index] + "</b></div>";
      }).join("")
      + "</div></article>"
      + '<article class="card"><div class="card-h"><h2>Recent activity</h2></div><ul class="audit">'
      + (recent.length ? recent.map(auditItem).join("") : '<li><span></span><span>No activity yet.</span><span></span></li>')
      + "</ul></article></div></section>";
  }

  function stat(value, label) {
    return '<article class="stat"><b>' + value + "</b><span>" + esc(label) + "</span></article>";
  }

  function auditItem(item) {
    return '<li><span class="bead ' + esc(item.tone || "") + '"></span><span>' + esc(item.text) + '</span><small class="muted">' + esc(when(item.at)) + "</small></li>";
  }

  function renderQueue() {
    const q = state.query.trim().toLowerCase();
    const rows = decorated().filter(function (item) {
      if (state.filter !== "all" && item.phase !== state.filter) return false;
      if (!q) return true;
      const blob = [item.order.id, item.order.poNumber, item.order.customer.extracted, item.order.source.file]
        .concat(item.order.lines.map(function (line) { return line.extractedSku + " " + line.extractedName; }))
        .join(" ").toLowerCase();
      return blob.indexOf(q) >= 0;
    });
    return ''
      + '<div class="page-head"><div><h1>Document queue</h1><p>Purchase documents for ' + esc(company().name) + ". Open one to check the extraction and post it.</p></div>"
      + '<input id="q" class="input search" placeholder="Search documents" value="' + esc(state.query) + '" aria-label="Search documents" /></div>'
      + '<div class="filters">' + FILTERS.map(function (item) {
        return '<button class="chip' + (state.filter === item[0] ? " on" : "") + '" data-act="filter" data-filter="' + item[0] + '" aria-pressed="' + (state.filter === item[0]) + '">' + item[1] + "</button>";
      }).join("") + "</div>"
      + '<div class="stack stagger">'
      + (rows.length ? rows.map(function (item) {
        const order = item.order;
        const note = item.phase === "extracting" ? "Reading line items" : (item.report.blocks[0] ? item.report.blocks[0].text : "Checks passed");
        return '<button class="order-row" data-act="open" data-id="' + esc(order.id) + '">'
          + '<span class="kind ' + kindClass(order.source.kind) + '">' + esc(order.source.kind === "Excel" ? "XLS" : order.source.kind === "Scan" ? "SCAN" : "PDF") + "</span>"
          + '<span class="grow"><strong class="ellipsis">' + esc(order.customer.extracted) + '</strong><br><small class="muted ellipsis">' + esc(note) + "</small></span>"
          + "<span><strong>" + esc(order.poNumber) + '</strong><br><small class="muted">' + esc(order.id) + "</small></span>"
          + pill(item.phase)
          + confBar(item.phase === "extracting" ? null : lowest(order))
          + '<span class="muted">' + esc(when(order.receivedAt)) + "</span></button>";
      }).join("") : '<div class="card empty">No documents in this view.</div>')
      + "</div>";
  }

  function paperHtml(order, blocks) {
    const duplicate = blocks.some(function (block) { return block.type === "duplicate"; });
    if (order.source.kind === "Excel") {
      return '<article class="paper sheet"><div class="sheet-bar"><span>' + esc(order.source.file) + "</span><span>Sheet 1</span></div>"
        + "<table><thead><tr><th class=\"idx\"></th><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead><tbody>"
        + '<tr><td class="idx">1</td><td>SKU</td><td>Description</td><td class="num">Qty</td><td class="num">Price</td></tr>'
        + order.lines.map(function (line, index) {
          return "<tr><td class=\"idx\">" + (index + 2) + "</td>"
            + "<td>" + cell(line.extractedSku, blocks, "sku", index) + "</td>"
            + "<td>" + esc(line.extractedName) + "</td>"
            + '<td class="num">' + cell(line.extractedQty == null ? "—" : line.extractedQty, blocks, "qty", index) + "</td>"
            + '<td class="num">' + cell(money(line.extractedPrice), blocks, "price", index) + "</td></tr>";
        }).join("")
        + '<tr><td class="idx">' + (order.lines.length + 2) + '</td><td colspan="4">PO ' + esc(order.poNumber) + " · " + esc(order.customer.extracted) + "</td></tr>"
        + "</tbody></table></article>";
    }
    return '<article class="paper' + (order.source.kind === "Scan" ? " scan" : "") + '">'
      + "<header><span>" + (order.source.kind === "Scan" ? "SCANNED DOCUMENT" : "PURCHASE ORDER") + "</span><span>" + esc(order.source.detail) + "</span></header>"
      + "<h3 class=\"" + (blocks.some(function (block) { return block.type === "customer"; }) ? "hl bad" : "hl") + "\">" + esc(order.customer.extracted) + "</h3>"
      + '<p class="muted" style="margin:0">' + esc(order.customer.extractedCity || "") + "</p>"
      + '<div class="mini"><div><span>PO NUMBER</span><strong class="hl">' + esc(order.poNumber) + "</strong></div><div><span>DELIVERY</span><strong>" + esc(day(order.delivery)) + "</strong></div></div>"
      + "<table><thead><tr><th>Item</th><th>Description</th><th class=\"num\">Qty</th><th class=\"num\">Price</th></tr></thead><tbody>"
      + order.lines.map(function (line, index) {
        return "<tr><td>" + cell(line.extractedSku, blocks, "sku", index) + "</td><td>" + esc(line.extractedName) + "</td>"
          + '<td class="num">' + cell(line.extractedQty == null ? "—" : line.extractedQty, blocks, "qty", index) + "</td>"
          + '<td class="num">' + cell(money(line.extractedPrice), blocks, "price", index) + "</td></tr>";
      }).join("")
      + "</tbody></table><footer><span>" + esc(order.source.file) + "</span><span>Sample document</span></footer>"
      + (duplicate ? '<div class="stamp">Duplicate</div>' : "")
      + "</article>";
  }

  function cell(value, blocks, type, index) {
    const bad = blocks.some(function (block) { return block.type === type && block.line === index; });
    return '<span class="' + (bad ? "hl bad" : "hl") + '">' + esc(value) + "</span>";
  }

  function renderOrder() {
    const order = currentOrder();
    if (!order) {
      return '<button class="back" data-act="nav" data-view="queue">← Queue</button><div class="card empty">This document is not in the current company.</div>';
    }
    const view = decorate(order);
    const locked = order.status === "posted" || order.status === "discarded" || order.status === "extracting";
    const matched = customerById(order.customer.matchId);
    const busy = state.busy === order.id;
    let issues = "";
    if (order.status === "extracting") {
      issues = '<div class="banner wait">Reading tables, item numbers, and quantities.</div><div class="shimmer"><span></span><span></span><span></span><span></span></div>';
    } else if (!view.report.blocks.length && view.phase === "ready") {
      issues = '<div class="banner">All checks passed. This document can be posted.</div>';
    } else if (order.status === "posted") {
      issues = '<div class="banner">Posted to Business Central as ' + esc(order.bcSalesOrder) + ".</div>";
    } else if (order.status === "discarded") {
      issues = '<div class="issue bad"><p>This document was discarded as a duplicate.</p><button class="btn btn-ghost btn-tiny" data-act="restore">Restore to the queue</button></div>';
    }
    view.report.blocks.forEach(function (block) {
      issues += issueCard(order, block, locked);
    });
    const lineRows = order.lines.map(function (line, index) {
      const prod = line.catalogSku ? productBySku(line.catalogSku) : null;
      const qty = locked
        ? esc(line.qty == null ? "—" : line.qty)
        : '<input class="qty" id="qty-' + index + '" data-act="qty" data-line="' + index + '" type="number" min="1" step="1" value="' + (line.qty == null ? "" : esc(line.qty)) + '" aria-label="Quantity for line ' + (index + 1) + '" />';
      return "<tr><td><strong>" + esc(prod ? prod.sku : line.extractedSku) + "</strong><br><small class=\"muted\">" + esc(prod ? prod.name : line.extractedName) + "</small></td>"
        + "<td>" + qty + "</td><td>" + money(line.extractedPrice) + "</td><td>" + (prod ? money(prod.price) : "—") + "</td><td><strong>" + money(postingPrice(line)) + "</strong></td></tr>";
    }).join("");
    const previewLines = order.lines.map(function (line) {
      const prod = line.catalogSku ? productBySku(line.catalogSku) : null;
      return "<tr><td>" + esc(prod ? prod.sku : line.extractedSku) + "</td><td>" + esc(line.qty == null ? "—" : line.qty) + "</td><td>" + money(postingPrice(line)) + "</td></tr>";
    }).join("");
    return ''
      + '<button class="back" data-act="nav" data-view="queue">← Queue</button>'
      + '<div class="order-head"><div><h1>' + esc(order.id) + "</h1><div style=\"display:flex;gap:8px;align-items:center;flex-wrap:wrap\">"
      + pill(view.phase) + '<span class="kind ' + kindClass(order.source.kind) + '">' + esc(order.source.kind) + "</span>"
      + "<span class=\"muted\">" + esc(order.source.file) + " · " + esc(when(order.receivedAt)) + "</span>"
      + (order.status === "extracting" ? "" : confBar(lowest(order)) + '<span class="muted">Lowest match ' + pct(lowest(order)) + "%</span>")
      + "</div></div><div class=\"head-actions\">"
      + (order.status === "discarded" ? "" : '<button class="btn btn-primary" data-act="approve" ' + (view.phase === "ready" && !busy ? "" : "disabled") + ">" + (busy ? "Creating sales order…" : "Approve and create sales order") + "</button>")
      + "</div></div>"
      + '<div class="order-grid"><div class="paper-wrap">' + (order.status === "extracting" ? '<article class="paper"><header><span>READING</span><span>' + esc(order.source.file) + '</span></header><div class="shimmer" style="margin-top:18px"><span></span><span></span><span></span><span></span></div></article>' : paperHtml(order, view.report.blocks)) + "</div>"
      + '<div class="side"><section class="card block"><h2>Extracted order</h2>'
      + '<div class="kv"><div><span>Customer</span><strong>' + esc(matched ? matched.name : "Not confirmed") + "</strong><small class=\"muted\">" + esc(matched ? matched.no + " · " + matched.city : order.customer.extracted) + "</small></div>"
      + "<div><span>Purchase order</span><strong>" + esc(order.poNumber) + "</strong><small class=\"muted\">Delivery " + esc(day(order.delivery)) + "</small></div></div>"
      + issues
      + '<table class="lines"><thead><tr><th>Item</th><th>Qty</th><th>Document</th><th>Catalog</th><th>Posting</th></tr></thead><tbody>' + lineRows + "</tbody></table>"
      + '<p style="text-align:right;margin:10px 0 0"><span class="muted">Order total </span><strong>' + money(orderTotal(order)) + "</strong></p>"
      + "</section>"
      + '<section class="card block"><h2>Checks</h2><ul class="checks">'
      + (view.report.pending ? "<li><span class=\"dot no\">…</span> Waiting for the read to finish</li>" : view.report.checks.map(function (check) {
        return "<li><span class=\"dot " + (check.ok ? "ok" : "no") + "\">" + (check.ok ? "✓" : "") + "</span>" + esc(check.label) + "</li>";
      }).join(""))
      + "</ul></section>"
      + '<section class="so"><div class="muted" style="font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase">Business Central</div>'
      + (order.bcSalesOrder ? "<b>" + esc(order.bcSalesOrder) + "</b>" : "<b>Sales order preview</b>")
      + "<p class=\"muted\" style=\"margin:4px 0 8px\">" + esc(company().bc.companyName) + " · " + esc(company().bc.environment) + "</p>"
      + "<table class=\"lines\"><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead><tbody>" + previewLines + "</tbody></table>"
      + '<p class="muted" style="margin:8px 0 0">External document number ' + esc(order.poNumber) + (matched ? " · Customer " + esc(matched.no) : "") + "</p></section></div></div>";
  }

  function issueCard(order, block) {
    if (block.type === "customer") {
      const choices = (order.customer.candidates.length ? order.customer.candidates : customers().map(function (item) { return item.id; })).map(function (id) {
        const cust = customerById(id);
        if (!cust) return "";
        return '<button class="choice" data-act="confirm-customer" data-customer="' + esc(cust.id) + '"><strong>' + esc(cust.name) + "</strong><small>" + esc(cust.no) + " · " + esc(cust.city) + " · " + esc(cust.terms) + "</small></button>";
      }).join("");
      return '<div class="issue"><p>' + esc(block.text) + "</p>" + choices + "</div>";
    }
    if (block.type === "duplicate") {
      return '<div class="issue bad"><p>' + esc(block.text) + '</p><div class="issue-actions">'
        + '<button class="btn btn-ghost btn-tiny" data-act="open" data-id="' + esc(order.duplicateOf) + '">View the other document</button>'
        + '<button class="btn btn-ghost btn-tiny" data-act="keep-duplicate">Keep as a separate order</button>'
        + '<button class="btn btn-danger btn-tiny" data-act="discard">Discard duplicate</button></div></div>';
    }
    if (block.type === "qty") {
      return '<div class="issue"><p>' + esc(block.text) + " Enter the quantity in the line table.</p></div>";
    }
    if (block.type === "sku") {
      const line = order.lines[block.line];
      const suggestions = (line.suggestions || []).map(function (sku) {
        const prod = productBySku(sku);
        if (!prod) return "";
        return '<button class="choice" data-act="map-sku" data-line="' + block.line + '" data-sku="' + esc(prod.sku) + '"><strong>' + esc(prod.sku) + " · " + esc(prod.name) + "</strong><small>" + money(prod.price) + " catalog</small></button>";
      }).join("");
      const options = products().map(function (prod) {
        return '<option value="' + esc(prod.sku) + '">' + esc(prod.sku) + " · " + esc(prod.name) + "</option>";
      }).join("");
      return '<div class="issue"><p>' + esc(block.text) + "</p>" + suggestions
        + '<label class="field" style="margin-top:8px"><span>Or choose from the catalog</span><select class="select" data-act="map-select" data-line="' + block.line + '"><option value="">Select an item</option>' + options + "</select></label></div>";
    }
    if (block.type === "price") {
      return '<div class="issue"><p>' + esc(block.text) + '</p><div class="issue-actions">'
        + '<button class="btn btn-soft btn-tiny" data-act="use-catalog" data-line="' + block.line + '">Use catalog price</button>'
        + '<button class="btn btn-ghost btn-tiny" data-act="keep-price" data-line="' + block.line + '">Keep document price</button></div></div>';
    }
    return "";
  }

  function renderProducts() {
    const q = state.query.trim().toLowerCase();
    const rows = products().filter(function (item) {
      return !q || (item.sku + " " + item.name).toLowerCase().indexOf(q) >= 0;
    });
    return pageTable("Product catalog", "Items used to check item numbers and prices for " + company().name + ".", rows, [
      ["SKU", function (item) { return esc(item.sku); }],
      ["Name", function (item) { return esc(item.name); }],
      ["Unit", function (item) { return esc(item.unit); }],
      ["Price", function (item) { return money(item.price); }],
      ["Stock", function (item) { return String(item.stock); }],
      ["In documents", function (item) {
        const count = orders().filter(function (order) {
          return order.lines.some(function (line) { return line.catalogSku === item.sku || line.extractedSku === item.sku; });
        }).length;
        return String(count);
      }],
    ], "No products match.");
  }

  function renderCustomers() {
    const q = state.query.trim().toLowerCase();
    const rows = customers().filter(function (item) {
      return !q || (item.no + " " + item.name + " " + item.city).toLowerCase().indexOf(q) >= 0;
    });
    return pageTable("Customers", "Master records used when a document names a buyer.", rows, [
      ["Number", function (item) { return esc(item.no); }],
      ["Name", function (item) { return esc(item.name); }],
      ["City", function (item) { return esc(item.city); }],
      ["Terms", function (item) { return esc(item.terms); }],
      ["Open documents", function (item) {
        const count = orders().filter(function (order) {
          return order.customer.matchId === item.id && order.status !== "posted" && order.status !== "discarded";
        }).length;
        return String(count);
      }],
    ], "No customers match.");
  }

  function pageTable(title, copy, rows, cols, empty) {
    return ''
      + '<div class="page-head"><div><h1>' + esc(title) + "</h1><p>" + esc(copy) + "</p></div>"
      + '<input id="q" class="input search" placeholder="Search" value="' + esc(state.query) + '" aria-label="Search" /></div>'
      + '<div class="table-wrap"><table class="data"><thead><tr>' + cols.map(function (col) { return "<th>" + col[0] + "</th>"; }).join("") + "</tr></thead><tbody>"
      + (rows.length ? rows.map(function (row) {
        return "<tr>" + cols.map(function (col) { return "<td>" + col[1](row) + "</td>"; }).join("") + "</tr>";
      }).join("") : '<tr><td colspan="' + cols.length + '">' + esc(empty) + "</td></tr>")
      + "</tbody></table></div>";
  }

  function renderCompanies() {
    return ''
      + '<div class="page-head"><div><h1>Companies</h1><p>Each company keeps its own documents, catalog, customers, and Business Central company.</p></div>'
      + '<button class="btn btn-primary" data-act="start-setup">New company</button></div>'
      + '<div class="co-grid stagger">' + DB.companies.map(function (item) {
        const count = (DB.orders[item.id] || []).length;
        const on = item.id === state.companyId;
        return '<button class="co-card' + (on ? " on" : "") + '" data-act="switch" data-id="' + esc(item.id) + '">'
          + '<span class="muted">' + esc(item.plan) + (on ? " · Current" : "") + "</span>"
          + "<h3>" + esc(item.name) + "</h3>"
          + "<p class=\"muted\">" + esc(item.city) + " · " + esc(item.vat) + "</p>"
          + "<p><strong>" + count + "</strong> documents in queue<br><span class=\"muted\">Business Central " + esc(item.bc.environment) + "</span></p></button>";
      }).join("") + "</div>";
  }

  function renderSetup() {
    const draft = state.setup;
    if (draft.step === 6 && draft.createdId) {
      const created = DB.companies.find(function (item) { return item.id === draft.createdId; });
      return '<div class="page-head"><div><h1>Guided setup</h1><p>No code required. The new company is ready.</p></div></div>'
        + '<section class="wiz-card"><div class="success-mark">✓</div><h2>' + esc(created ? created.name : "Company") + " is ready</h2>"
        + "<p class=\"muted\">A sample purchase document is already in the queue, matched to Feldmann Fertigung GmbH. Open the workspace and post it when you want to see Business Central.</p>"
        + '<div class="wiz-nav"><button class="btn btn-ghost" data-act="start-setup">Add another</button><button class="btn btn-primary" data-act="open-created">Open workspace</button></div></section>';
    }
    const body = [
      companyStep(draft),
      connectionStep(draft),
      catalogStep(draft),
      channelStep(draft),
      teamStep(draft),
      reviewStep(draft),
    ][draft.step] || "";
    return ''
      + '<div class="page-head"><div><h1>Guided setup</h1><p>Add a company, connect Business Central, and start from a sample catalog.</p></div></div>'
      + '<div class="wiz"><ol class="stepper">' + SETUP_STEPS.map(function (label, index) {
        const cls = index === draft.step ? "on" : index < draft.step ? "done" : "";
        return '<li><button class="' + cls + '" data-act="setup-goto" data-step="' + index + '"' + (index > draft.step ? " disabled" : "") + '><i>' + (index < draft.step ? "✓" : index + 1) + "</i>" + label + "</button></li>";
      }).join("") + "</ol><section class=\"wiz-card\">"
      + (draft.error ? '<p class="form-error">' + esc(draft.error) + "</p>" : "")
      + body
      + '<div class="wiz-nav"><button class="btn btn-ghost" data-act="setup-back"' + (draft.step === 0 ? " disabled" : "") + ">Back</button>"
      + '<button class="btn btn-primary" data-act="setup-next">' + (draft.step === 5 ? "Create workspace" : "Continue") + "</button></div></section></div>";
  }

  function companyStep(draft) {
    return "<h2>Company profile</h2><p class=\"muted\">This becomes a separate workspace with its own data.</p>"
      + '<div class="form-grid">'
      + field("co-name", "Legal name", draft.name, "text", "full")
      + field("co-city", "City", draft.city, "text")
      + field("co-vat", "VAT ID", draft.vat, "text")
      + "</div>";
  }

  function connectionStep(draft) {
    return "<h2>Business Central</h2><p class=\"muted\">Point Klario at the company inside Dynamics 365 Business Central. This demonstration approves the connection locally.</p>"
      + '<div class="form-grid">'
      + '<label class="field"><span>Environment</span><select id="co-env" class="select"><option' + (draft.env === "Sandbox" ? " selected" : "") + '>Sandbox</option><option' + (draft.env === "Production" ? " selected" : "") + ">Production</option></select></label>"
      + field("co-bc", "BC company name", draft.bcCompany, "text")
      + "</div>"
      + '<div class="wiz-nav" style="justify-content:flex-start"><button class="btn btn-soft" type="button" data-act="test-bc">' + (state.busy === "bc-test" ? "Testing…" : "Test connection") + "</button></div>"
      + (draft.bcOk ? '<p class="banner">Connected to ' + esc(draft.env) + " · " + esc(draft.bcCheckedName) + ".</p>" : "");
  }

  function catalogStep(draft) {
    const selected = PACKS.find(function (item) { return item.id === draft.catalog; });
    const preview = selected ? (DB.catalog[selected.from] || []).slice(0, 4) : [];
    return "<h2>Starting catalog</h2><p class=\"muted\">Pick a sample catalog. You can replace it later from Business Central.</p><div class=\"choices\">"
      + PACKS.map(function (pack) {
        return '<button class="choice' + (draft.catalog === pack.id ? " on" : "") + '" data-act="pick-pack" data-pack="' + pack.id + '"><strong>' + esc(pack.label) + "</strong><small>" + esc(pack.detail) + "</small></button>";
      }).join("")
      + "</div>"
      + (preview.length ? '<div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>SKU</th><th>Name</th><th>Price</th></tr></thead><tbody>'
        + preview.map(function (item) { return "<tr><td>" + esc(item.sku) + "</td><td>" + esc(item.name) + "</td><td>" + money(item.price) + "</td></tr>"; }).join("")
        + "</tbody></table></div>" : "");
  }

  function channelStep(draft) {
    return "<h2>Document channels</h2><p class=\"muted\">Choose how purchase orders arrive. Sample files stand in for a live folder.</p><div class=\"toggles\">"
      + toggle("pdf", "PDF documents", "Multi-page purchase orders", draft.pdf)
      + toggle("excel", "Excel workbooks", "Spreadsheets with line items", draft.excel)
      + "</div><div class=\"filechips\">"
      + (draft.pdf ? '<span class="filechip">PO-sample.pdf</span>' : "")
      + (draft.excel ? '<span class="filechip">order-sample.xlsx</span>' : "")
      + "</div>";
  }

  function teamStep(draft) {
    return "<h2>Reviewer</h2><p class=\"muted\">This person administers the company and works the queue.</p>"
      + '<div class="form-grid">' + field("co-reviewer", "Reviewer name", draft.reviewer, "text", "full") + "</div>";
  }

  function reviewStep(draft) {
    const pack = PACKS.find(function (item) { return item.id === draft.catalog; });
    const channels = [draft.pdf ? "PDF" : "", draft.excel ? "Excel" : ""].filter(Boolean).join(" and ");
    return "<h2>Review</h2><p class=\"muted\">Create the workspace when this looks right.</p>"
      + '<div class="kv" style="margin-top:12px"><div><span>Company</span><strong>' + esc(draft.name) + "</strong><small class=\"muted\">" + esc(draft.city) + " · " + esc(draft.vat) + "</small></div>"
      + "<div><span>Business Central</span><strong>" + esc(draft.bcCompany) + "</strong><small class=\"muted\">" + esc(draft.env) + "</small></div>"
      + "<div><span>Catalog</span><strong>" + esc(pack ? pack.label : "—") + "</strong></div>"
      + "<div><span>Channels</span><strong>" + esc(channels || "—") + "</strong><small class=\"muted\">Reviewer " + esc(draft.reviewer) + "</small></div></div>";
  }

  function field(id, label, value, type, extra) {
    return '<label class="field' + (extra ? " " + extra : "") + '"><span>' + label + '</span><input id="' + id + '" class="input" type="' + type + '" value="' + esc(value) + '" /></label>';
  }

  function toggle(key, title, detail, on) {
    return '<button class="toggle' + (on ? " on" : "") + '" type="button" data-act="toggle-ch" data-ch="' + key + '" aria-pressed="' + on + '"><span><strong>' + title + "</strong><br><small class=\"muted\">" + detail + '</small></span><span class="switch"></span></button>';
  }

  function renderBc() {
    const co = company();
    const posted = orders().filter(function (order) { return order.bcSalesOrder; }).sort(function (a, b) {
      return new Date(b.postedAt || 0) - new Date(a.postedAt || 0);
    });
    return ''
      + '<div class="page-head"><div><h1>Business Central</h1><p>Approved documents become sales orders in ' + esc(co.bc.companyName) + ".</p></div>"
      + '<button class="btn btn-primary" data-act="sync-bc">' + (state.busy === "sync" ? "Syncing…" : "Sync now") + "</button></div>"
      + '<section class="card" style="margin-bottom:12px"><div class="conn"><div><span class="ok-dot"></span> <strong> Connected</strong>'
      + '<p class="muted" style="margin:6px 0 0">' + esc(co.bc.environment) + " · " + esc(co.bc.companyName) + "<br>Last sync " + esc(when(co.bc.lastSync)) + "</p></div>"
      + "<div><span class=\"muted\">Company data</span><br><strong>" + products().length + "</strong> products · <strong>" + customers().length + "</strong> customers</div></div></section>"
      + '<section class="card"><div class="card-h"><h2>Sales orders created here</h2></div>'
      + (posted.length ? '<table class="lines"><thead><tr><th>Document</th><th>Customer PO</th><th>Sales order</th><th>When</th></tr></thead><tbody>'
        + posted.map(function (order) {
          const cust = customerById(order.customer.matchId);
          return '<tr><td><button class="linkish" data-act="open" data-id="' + esc(order.id) + '">' + esc(order.id) + "</button></td><td>" + esc(order.poNumber) + "<br><small class=\"muted\">" + esc(cust ? cust.name : order.customer.extracted) + "</small></td><td><strong>" + esc(order.bcSalesOrder) + "</strong></td><td>" + esc(when(order.postedAt)) + "</td></tr>";
        }).join("") + "</tbody></table>" : '<p class="empty">No sales orders posted yet.</p>')
      + "</section>";
  }

  function renderProtection() {
    const co = company();
    const events = DB.audit.filter(function (item) { return item.companyId === co.id; });
    const facts = [
      ["EU residency", "Documents and master data for this demonstration are described as stored in Frankfurt. Nothing in the product story is sent outside the European Union."],
      ["Encryption", "AES-256 at rest and TLS in transit, including the connection to Business Central."],
      ["Separate companies", "Switching company loads only that company’s catalog, customers, documents, and audit events."],
      ["Roles", "Admins connect Business Central and add companies. Reviewers work the queue. Both actions are written to the audit log."],
      ["Agreement", "A data processing agreement is marked signed for each sample company."],
      ["Retention", "Sample policy keeps order documents for 24 months, then removes them."],
    ];
    return ''
      + '<div class="page-head"><div><h1>Protection</h1><p>Controls for ' + esc(co.name) + ". Suitable for German business customers, shown here with sample data.</p></div></div>"
      + '<div class="fact-grid stagger">' + facts.map(function (fact) {
        return '<article class="fact"><h3>' + fact[0] + "</h3><p>" + fact[1] + "</p></article>";
      }).join("") + "</div>"
      + '<section class="split" style="margin-top:12px"><article class="card"><div class="card-h"><h2>People</h2></div><table class="lines"><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody>'
      + co.users.map(function (person) { return "<tr><td>" + esc(person.name) + "</td><td>" + esc(person.role) + "</td></tr>"; }).join("")
      + '</tbody></table></article><article class="card"><div class="card-h"><h2>Audit log</h2><span class="muted">This company only</span></div><ul class="audit">'
      + (events.length ? events.slice(0, 12).map(auditItem).join("") : "<li><span></span><span>No events yet.</span><span></span></li>")
      + "</ul></article></section>";
  }

  function renderPlan() {
    const co = company();
    const limit = co.volumeLimit;
    const width = limit ? Math.min(100, Math.round((co.volumeUsed / limit) * 100)) : 100;
    return ''
      + '<div class="page-head"><div><h1>Subscription</h1><p>Illustrative monthly plans. ' + esc(co.name) + " is on " + esc(co.plan) + ".</p></div>"
      + '<button class="btn btn-ghost" data-act="reset">Reset sample data</button></div>'
      + '<section class="card" style="margin-bottom:12px"><strong>' + co.volumeUsed + (limit ? " of " + limit : "") + "</strong> documents this month"
      + '<div class="usage"><div class="meter"><span style="width:' + width + '%"></span></div></div>'
      + '<p class="muted">The meter is sample usage for the active company. Approving a document adds one.</p></section>'
      + '<div class="plan-grid stagger">' + PLANS.map(function (plan) {
        const current = co.plan === plan.id;
        return '<article class="plan' + (current ? " current" : "") + '"><span class="muted">' + (current ? "Current plan" : "Plan") + "</span><h3>" + plan.id + '</h3><div class="price">' + plan.price + '</div><div class="muted">' + plan.period + "</div><ul>"
          + plan.points.map(function (point) { return "<li>" + point + "</li>"; }).join("")
          + '</ul><button class="btn ' + (current ? "btn-soft" : "btn-primary") + '" data-act="switch-plan" data-plan="' + plan.id + '"' + (current ? " disabled" : "") + ">" + (current ? "Current plan" : "Switch to " + plan.id) + "</button></article>";
      }).join("") + "</div>";
  }

  function renderPage() {
    if (state.view === "overview") return renderOverview();
    if (state.view === "queue") return renderQueue();
    if (state.view === "order") return renderOrder();
    if (state.view === "products") return renderProducts();
    if (state.view === "customers") return renderCustomers();
    if (state.view === "companies") return renderCompanies();
    if (state.view === "setup") return renderSetup();
    if (state.view === "bc") return renderBc();
    if (state.view === "protection") return renderProtection();
    if (state.view === "plan") return renderPlan();
    return renderOverview();
  }

  function render() {
    const focus = document.activeElement;
    const focusId = focus && focus.id;
    let start = null;
    let end = null;
    try {
      if (focus && typeof focus.selectionStart === "number") {
        start = focus.selectionStart;
        end = focus.selectionEnd;
      }
    } catch (err) { /* number inputs do not expose a caret */ }
    const scrollY = window.scrollY;
    const root = document.getElementById("app");
    root.innerHTML = state.authed ? renderShell(renderPage()) : renderLogin();
    document.title = (state.authed ? (state.view === "order" && state.orderId ? state.orderId + " · " : "") : "") + "Klario · Order intake";
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (start != null && el.setSelectionRange) {
          try { el.setSelectionRange(start, end); } catch (err) { /* number inputs */ }
        }
      }
    }
    if (anim) window.scrollTo(0, 0);
    else window.scrollTo(0, scrollY);
    anim = false;
  }

  function onClick(event) {
    if (state.view === "setup") captureSetup();
    const actor = event.target.closest("[data-act]");
    const inMenu = event.target.closest(".switcher");
    if (!inMenu && state.menu) {
      state.menu = null;
      if (!actor) { render(); return; }
    }
    if (!actor) return;
    const act = actor.dataset.act;
    if (act === "nav") { navigate(actor.dataset.view); return; }
    if (act === "menu") { state.menu = state.menu === "company" ? null : "company"; render(); return; }
    if (act === "switch") {
      state.companyId = actor.dataset.id;
      state.query = "";
      state.menu = null;
      navigate(state.view === "order" ? "queue" : state.view);
      return;
    }
    if (act === "lock") { lock(); return; }
    if (act === "open") { navigate("order", { orderId: actor.dataset.id }); return; }
    if (act === "filter") { state.filter = actor.dataset.filter; render(); return; }
    if (act === "approve") { const order = currentOrder(); if (order) approve(order); return; }
    if (act === "confirm-customer") {
      const order = currentOrder();
      if (!order) return;
      order.customer.matchId = actor.dataset.customer;
      order.customer.confirmed = true;
      audit(userName() + " confirmed the customer on " + order.id + ".", "info");
      persist(); render(); return;
    }
    if (act === "map-sku") { mapLine(Number(actor.dataset.line), actor.dataset.sku); return; }
    if (act === "use-catalog") {
      const order = currentOrder();
      const line = order && order.lines[Number(actor.dataset.line)];
      const prod = line && productBySku(line.catalogSku);
      if (!line || !prod) return;
      line.price = prod.price;
      line.priceDecision = "catalog";
      audit(userName() + " applied the catalog price on " + order.id + ".", "info");
      persist(); render(); return;
    }
    if (act === "keep-price") {
      const order = currentOrder();
      const line = order && order.lines[Number(actor.dataset.line)];
      if (!line) return;
      line.price = line.extractedPrice;
      line.priceDecision = "keep";
      audit(userName() + " kept the document price on " + order.id + ".", "info");
      persist(); render(); return;
    }
    if (act === "keep-duplicate") {
      const order = currentOrder();
      if (!order) return;
      order.duplicateCleared = true;
      audit(userName() + " kept " + order.id + " as a separate order.", "warn");
      persist(); render(); return;
    }
    if (act === "discard") {
      const order = currentOrder();
      if (!order) return;
      order.status = "discarded";
      audit(userName() + " discarded " + order.id + " as a duplicate.", "warn");
      persist();
      toast(order.id + " discarded.");
      render(); return;
    }
    if (act === "restore") {
      const order = currentOrder();
      if (!order) return;
      order.status = "active";
      audit(userName() + " restored " + order.id + " to the queue.", "info");
      persist(); render(); return;
    }
    if (act === "start-setup") { state.setup = defaultSetup(); navigate("setup"); return; }
    if (act === "setup-next") { setupNext(); return; }
    if (act === "setup-back") {
      state.setup.error = "";
      state.setup.step = Math.max(0, state.setup.step - 1);
      anim = true; render(); return;
    }
    if (act === "setup-goto") {
      const step = Number(actor.dataset.step);
      if (step <= state.setup.step) { state.setup.step = step; state.setup.error = ""; anim = true; render(); }
      return;
    }
    if (act === "pick-pack") { state.setup.catalog = actor.dataset.pack; state.setup.error = ""; render(); return; }
    if (act === "toggle-ch") {
      const key = actor.dataset.ch;
      const next = !state.setup[key];
      if (!next && ((key === "pdf" && !state.setup.excel) || (key === "excel" && !state.setup.pdf))) {
        toast("Keep at least one document channel.");
        return;
      }
      state.setup[key] = next;
      render(); return;
    }
    if (act === "test-bc") {
      if (!state.setup.bcCompany) { state.setup.error = "Add the Business Central company name."; render(); return; }
      state.busy = "bc-test";
      state.setup.error = "";
      render();
      setTimeout(function () {
        state.busy = null;
        state.setup.bcOk = true;
        state.setup.bcCheckedName = state.setup.bcCompany;
        toast("Business Central connection succeeded.");
        render();
      }, 800);
      return;
    }
    if (act === "open-created") {
      state.companyId = state.setup.createdId;
      navigate("overview");
      return;
    }
    if (act === "sync-bc") {
      state.busy = "sync";
      render();
      setTimeout(function () {
        company().bc.lastSync = new Date().toISOString();
        audit("Sync finished. " + products().length + " products and " + customers().length + " customers.", "info");
        persist();
        state.busy = null;
        toast("Sync finished. " + products().length + " products and " + customers().length + " customers.");
        render();
      }, 800);
      return;
    }
    if (act === "switch-plan") {
      const plan = PLANS.find(function (item) { return item.id === actor.dataset.plan; });
      if (!plan) return;
      const co = company();
      co.plan = plan.id;
      co.volumeLimit = plan.limit;
      audit("Plan changed to " + plan.id + ".", "info");
      persist();
      toast(co.name + " is now on " + plan.id + ".");
      render(); return;
    }
    if (act === "reset") {
      if (!window.confirm("Reset all sample changes in this browser?")) return;
      localStorage.removeItem(KEY);
      location.reload();
    }
  }

  function mapLine(index, sku) {
    const order = currentOrder();
    const line = order && order.lines[index];
    const prod = productBySku(sku);
    if (!line || !prod) return;
    line.catalogSku = prod.sku;
    line.wasUnknown = true;
    if (cents(line.price) === cents(prod.price)) line.priceDecision = null;
    else line.priceDecision = null;
    audit(userName() + " matched " + line.extractedSku + " to " + prod.sku + " on " + order.id + ".", "info");
    persist();
    render();
  }

  function onInput(event) {
    const el = event.target;
    if (el.id === "q") {
      state.query = el.value;
      render();
      return;
    }
    if (el.dataset.act === "qty") {
      const order = currentOrder();
      const line = order && order.lines[Number(el.dataset.line)];
      if (!line) return;
      const value = el.value;
      line.qty = value === "" || Number.isNaN(Number(value)) ? null : Number(value);
      persist();
      render();
    }
  }

  function onChange(event) {
    const el = event.target;
    if (el.dataset.act === "map-select") {
      if (!el.value) return;
      mapLine(Number(el.dataset.line), el.value);
    }
  }

  document.body.addEventListener("click", onClick);
  document.body.addEventListener("input", onInput);
  document.body.addEventListener("change", onChange);
  document.body.addEventListener("submit", function (event) {
    if (event.target.id === "gate") {
      event.preventDefault();
      enter();
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.menu) {
      state.menu = null;
      render();
    }
  });
  window.addEventListener("hashchange", function () {
    if (!state.authed) return;
    applyHash();
    anim = true;
    render();
  });

  if (state.authed) {
    applyHash();
    armExtractor();
  }
  render();
})();
