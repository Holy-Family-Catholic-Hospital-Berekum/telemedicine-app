// Starts a fake Paystack for the end-to-end tests on 127.0.0.1:4599.
//
// The emulated functions ask it "was this payment made?" (lib/paystack.js
// PAYSTACK_API_BASE, honoured only in the emulator). The tests' stand-in
// payment window (helpers.mjs stubPaystack) tells it what was "paid" via
// POST /__paid. Shapes follow Paystack's transaction/verify response.
import http from "node:http";

const paid = new Map(); // reference -> { amount (pesewas), currency, email }
let nextId = 1000;

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

export default async function globalSetup() {
  // deepcode ignore HttpToHttps: a fake Paystack listening only on 127.0.0.1 for the duration of the tests.
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/__paid") {
      const p = await readJson(req);
      paid.set(p.reference, { amount: p.amount, currency: p.currency || "GHS", email: p.email, id: nextId++ });
      return send(res, 200, { ok: true });
    }
    const verify = /^\/transaction\/verify\/(.+)$/.exec(url.pathname);
    if (req.method === "GET" && verify) {
      const reference = decodeURIComponent(verify[1]);
      const p = paid.get(reference);
      if (!p) return send(res, 400, { status: false, message: "Transaction reference not found" });
      return send(res, 200, {
        status: true,
        message: "Verification successful",
        data: {
          id: p.id,
          status: "success",
          reference,
          amount: p.amount,
          currency: p.currency,
          channel: "mobile_money",
          fees: Math.round(p.amount * 0.0195),
          paid_at: new Date().toISOString(),
          customer: { email: p.email },
        },
      });
    }
    // Lists (reconciliation) and refunds: nothing to report.
    if (url.pathname.startsWith("/transaction")) return send(res, 200, { status: true, data: [], meta: { pageCount: 1 } });
    if (url.pathname.startsWith("/refund")) return send(res, 200, { status: true, data: { id: nextId++, status: "pending" } });
    return send(res, 404, { status: false, message: "Not found" });
  });
  await new Promise((resolve) => server.listen(4599, "127.0.0.1", resolve));
  return async () => new Promise((resolve) => server.close(resolve));
}
