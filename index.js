const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// የ Telegram መረጃዎች (ከ Config ወይም ነባሪ)
const TELEGRAM_BOT_TOKEN = functions.config().telegram?.token || "8779386690:AAFrSyxbsheMNod0TVfiHHWaeLSihQ7MMKg";
const ADMIN_CHAT_ID = functions.config().telegram?.chat_id || "801120038";

// 1. የክፍያ ማስጀመሪያ Function (Pay With Chapa)
exports.payWithChapa = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send({ error: "Method Not Allowed" });
    }

    try {
      const { amount, email, firstName, lastName, phone, items } = req.body;
      const CHAPA_SECRET_KEY = functions.config().chapa?.secret_key;

      const tx_ref = `jinka-tx-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      await db.collection("orders").doc(tx_ref).set({
        tx_ref: tx_ref,
        customer_name: `${firstName} ${lastName}`,
        email: email || "",
        phone: phone,
        amount: Number(amount),
        status: "pending",
        items: items,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const chapaResponse = await axios.post(
        "https://api.chapa.co/v1/transaction/initialize",
        {
          amount: amount,
          currency: "ETB",
          email: email,
          first_name: firstName,
          last_name: lastName,
          phone_number: phone,
          tx_ref: tx_ref,
          callback_url: `https://us-central1-${process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT}.cloudfunctions.net/chapaWebhook`,
          return_url: "https://jinkamarkets.et/success.html", // <--- አዲሱን ዶሜይን እዚህ አገባ
          customization: {
            title: "ጂንካ ገበያ",
            description: "የእቃዎች ክፍያ"
          }
        },
        {
          headers: {
            Authorization: `Bearer ${CHAPA_SECRET_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      if (chapaResponse.data.status === "success") {
        return res.status(200).json({
          checkout_url: chapaResponse.data.data.checkout_url,
          tx_ref: tx_ref
        });
      } else {
        return res.status(400).json({ error: "Chapa initialization failed" });
      }
    } catch (error) {
      console.error("Payment Error:", error);
      return res.status(500).json({ error: error.message });
    }
  });
});

// 2. የክፍያ ማረጋገጫ Webhook Function (Chapa Webhook)
exports.chapaWebhook = functions.https.onRequest(async (req, res) => {
  try {
    const data = req.body;

    if (data.status === "success" || data.event === "charge.success") {
      const tx_ref = data.tx_ref;

      await db.collection("orders").doc(tx_ref).update({
        status: "completed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`Transaction ${tx_ref} successfully marked as completed.`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(400).send("Webhook Error");
  }
});

// 3. የቴሌግራም መልእክት መላኪያ Function (Send Telegram Notification)
exports.sendTelegram = functions.https.onRequest((req, res) => {
  return cors(req, res, async () => {
    if (req.method !== "POST") {
      return res.status(405).send({ error: "Method Not Allowed" });
    }

    const { message } = req.body;
    if (!message) {
      return res.status(400).send({ error: "Message field is required" });
    }

    try {
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      await axios.post(telegramUrl, {
        chat_id: ADMIN_CHAT_ID,
        text: message,
        parse_mode: "HTML"
      });

      return res.status(200).send({ success: true, message: "Notification sent successfully!" });
    } catch (error) {
      console.error("Telegram API Error:", error.response ? error.response.data : error.message);
      return res.status(500).send({ error: "Failed to send notification via Telegram" });
    }
  });
});