/**
 * Handles payment processing for membership dues and fines (F8).
 * PayPal: structured for their REST API (sandbox-ready).
 * GCash / PayMaya: stubbed with their expected request shape — replace with real SDK calls.
 */
class Payment {
  constructor(paymentID, memberID, amount, method, type = "fine", timestamp = new Date(), status = "pending", referenceID = null) {
    this.paymentID   = paymentID;
    this.memberID    = memberID;
    this.amount      = amount;
    this.method      = method;      // 'gcash' | 'paymaya' | 'paypal' | 'card'
    this.type        = type;        // 'fine' | 'membership'
    this.timestamp   = timestamp;
    this.status      = status;      // 'pending' | 'confirmed' | 'failed'
    this.referenceID = referenceID;
  }

  // ── Main Entry Point ──────────────────────────────────────────────────────────

  /**
   * Routes payment to the correct gateway and returns result.
   * @param {object} [credentials] - gateway-specific API keys from environment
   * @returns {Promise<{ success: boolean, referenceID: string|null, message: string }>}
   */
  async processPayment(credentials = {}) {
    if (this.amount <= 0) throw new Error("Payment amount must be greater than 0.");

    let result;
    switch (this.method) {
      case "paypal" : result = await this._processPayPal(credentials.paypal); break;
      case "gcash"  : result = await this._processGCash(credentials.gcash);   break;
      case "paymaya": result = await this._processPayMaya(credentials.paymaya); break;
      case "card"   : result = await this._processCard(credentials.card);     break;
      default: throw new Error(`Unsupported payment method: ${this.method}`);
    }

    this.status      = result.success ? "confirmed" : "failed";
    this.referenceID = result.referenceID || null;
    this.timestamp   = new Date();

    // TODO: db.insertPayment(this.toJSON())
    // TODO: if success && type === 'fine', Fine.markPaid(this.paymentID)
    // TODO: if success && type === 'membership', db.activateMembership(this.memberID)

    return result;
  }

  // ── PayPal ────────────────────────────────────────────────────────────────────

  /**
   * PayPal REST API — sandbox-ready structure.
   * Docs: https://developer.paypal.com/docs/api/orders/v2/
   * @param {{ clientID: string, clientSecret: string, baseURL: string }} creds
   */
  async _processPayPal(creds = {}) {
    const {
      clientID     = process.env.PAYPAL_CLIENT_ID,
      clientSecret = process.env.PAYPAL_CLIENT_SECRET,
      baseURL      = process.env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com",
    } = creds;

    if (!clientID || !clientSecret) {
      throw new Error("PayPal credentials not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.");
    }

    try {
      // Step 1: Get access token
      const authRes = await fetch(`${baseURL}/v1/oauth2/token`, {
        method : "POST",
        headers: {
          "Content-Type" : "application/x-www-form-urlencoded",
          "Authorization": `Basic ${Buffer.from(`${clientID}:${clientSecret}`).toString("base64")}`,
        },
        body: "grant_type=client_credentials",
      });
      const authData   = await authRes.json();
      const accessToken = authData.access_token;
      if (!accessToken) throw new Error(`PayPal auth failed: ${JSON.stringify(authData)}`);

      // Step 2: Create order
      const orderRes = await fetch(`${baseURL}/v2/checkout/orders`, {
        method : "POST",
        headers: {
          "Content-Type" : "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          intent             : "CAPTURE",
          purchase_units     : [{
            amount          : { currency_code: "PHP", value: this.amount.toFixed(2) },
            description     : `JusBooks ${this.type} payment — Member #${this.memberID}`,
          }],
        }),
      });
      const order = await orderRes.json();

      // Step 3: Capture order (in a real app, this happens after user approves in the PayPal UI)
      // For server-side / direct capture (sandbox testing):
      const captureRes = await fetch(`${baseURL}/v2/checkout/orders/${order.id}/capture`, {
        method : "POST",
        headers: {
          "Content-Type" : "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
      });
      const capture = await captureRes.json();
      const success = capture.status === "COMPLETED";

      return {
        success    : success,
        referenceID: capture.id || null,
        message    : success ? "PayPal payment captured." : `PayPal capture failed: ${capture.status}`,
      };
    } catch (err) {
      console.error("[Payment] PayPal error:", err.message);
      return { success: false, referenceID: null, message: err.message };
    }
  }

  // ── GCash (via PayMongo) ──────────────────────────────────────────────────────

  /**
   * GCash via PayMongo API.
   * Docs: https://developers.paymongo.com/docs/gcash-integration
   * @param {{ secretKey: string }} creds
   */
  async _processGCash(creds = {}) {
    const secretKey = creds.secretKey || process.env.PAYMONGO_SECRET_KEY;
    if (!secretKey) throw new Error("PayMongo secret key not configured (PAYMONGO_SECRET_KEY).");

    try {
      // Step 1: Create a GCash source
      const sourceRes = await fetch("https://api.paymongo.com/v1/sources", {
        method : "POST",
        headers: {
          "Content-Type" : "application/json",
          "Authorization": `Basic ${Buffer.from(secretKey).toString("base64")}`,
        },
        body: JSON.stringify({
          data: {
            attributes: {
              amount  : Math.round(this.amount * 100), // PayMongo uses centavos
              currency: "PHP",
              type    : "gcash",
              redirect: {
                success: process.env.PAYMENT_SUCCESS_URL || "https://jusbooks.app/payment/success",
                failed : process.env.PAYMENT_FAILED_URL  || "https://jusbooks.app/payment/failed",
              },
            },
          },
        }),
      });

      const source = await sourceRes.json();
      const checkoutURL = source?.data?.attributes?.redirect?.checkout_url;

      // In a real app: redirect user to checkoutURL, then listen for PayMongo webhook
      // to confirm the payment (source.chargeable event).
      // TODO: store source.data.id as referenceID, return checkoutURL to frontend

      return {
        success    : !!checkoutURL,
        referenceID: source?.data?.id || null,
        checkoutURL: checkoutURL || null,
        message    : checkoutURL ? "Redirect user to GCash checkout." : "GCash source creation failed.",
      };
    } catch (err) {
      console.error("[Payment] GCash error:", err.message);
      return { success: false, referenceID: null, message: err.message };
    }
  }

  // ── PayMaya ───────────────────────────────────────────────────────────────────

  /**
   * Maya (formerly PayMaya) Checkout API.
   * Docs: https://developers.maya.ph/docs
   * @param {{ publicKey: string, secretKey: string }} creds
   */
  async _processPayMaya(creds = {}) {
    const publicKey  = creds.publicKey  || process.env.MAYA_PUBLIC_KEY;
    const secretKey  = creds.secretKey  || process.env.MAYA_SECRET_KEY;
    if (!publicKey || !secretKey) throw new Error("Maya credentials not configured (MAYA_PUBLIC_KEY, MAYA_SECRET_KEY).");

    try {
      const res = await fetch("https://pg-sandbox.paymaya.com/checkout/v1/checkouts", {
        method : "POST",
        headers: {
          "Content-Type" : "application/json",
          "Authorization": `Basic ${Buffer.from(publicKey).toString("base64")}`,
        },
        body: JSON.stringify({
          totalAmount: {
            value   : this.amount,
            currency: "PHP",
          },
          buyer: {
            contact: { email: "" }, // TODO: pass member email
          },
          items: [{
            name    : `JusBooks ${this.type}`,
            quantity: 1,
            amount  : { value: this.amount },
            totalAmount: { value: this.amount },
          }],
          redirectUrl: {
            success: process.env.PAYMENT_SUCCESS_URL || "https://jusbooks.app/payment/success",
            failure: process.env.PAYMENT_FAILED_URL  || "https://jusbooks.app/payment/failed",
            cancel : process.env.PAYMENT_CANCEL_URL  || "https://jusbooks.app/payment/cancel",
          },
          requestReferenceNumber: `JUSBOOKS-${this.memberID}-${Date.now()}`,
        }),
      });

      const data        = await res.json();
      const checkoutURL = data.redirectUrl;

      return {
        success    : !!checkoutURL,
        referenceID: data.checkoutId || null,
        checkoutURL: checkoutURL     || null,
        message    : checkoutURL ? "Redirect user to Maya checkout." : "Maya checkout creation failed.",
      };
    } catch (err) {
      console.error("[Payment] Maya error:", err.message);
      return { success: false, referenceID: null, message: err.message };
    }
  }

  // ── Card (generic placeholder) ────────────────────────────────────────────────

  /**
   * Card payment stub — integrate with Stripe, Braintree, or PayMongo card.
   * @param {object} creds
   */
  async _processCard(creds = {}) {
    // TODO: integrate with your card processor
    // Stripe example:
    //   const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    //   const intent = await stripe.paymentIntents.create({ amount: ..., currency: 'php' });
    console.warn("[Payment] Card payment not yet integrated.");
    return { success: false, referenceID: null, message: "Card payment not yet configured." };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  getConfirmation() {
    return {
      paymentID  : this.paymentID,
      memberID   : this.memberID,
      amount     : this.amount,
      method     : this.method,
      type       : this.type,
      status     : this.status,
      referenceID: this.referenceID,
      timestamp  : this.timestamp,
    };
  }

  toJSON() { return this.getConfirmation(); }
}

module.exports = Payment;
