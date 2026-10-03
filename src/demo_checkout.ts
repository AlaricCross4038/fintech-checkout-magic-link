export {};

const input = {
  requestId: "signin-cart-1042",
  userId: "customer_2048",
  email: process.env.TEST_EMAIL ?? (() => { throw new Error("TEST_EMAIL is required"); })(),
  paymentEvent: {
    eventId: "payment_1042",
    type: "checkout_payment_authorized",
    amountMinor: 12900,
    currency: "USD",
  },
  risk: { score: 18, newDevice: false },
};

const response = await fetch("http://localhost:3000/signin/request", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(input),
});
console.log(JSON.stringify(await response.json(), null, 2));
