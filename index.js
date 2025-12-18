ready kore dau

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const Stripe = require("stripe");

const app = express();
const port = process.env.PORT || 3000;

// ===============================
// MIDDLEWARE
// ===============================
app.use(cors());

// ⚠️ webhook এর জন্য raw body লাগবে
app.use(
  "/stripe-webhook",
  express.raw({ type: "application/json" })
);
app.use(express.json());

// ===============================
// STRIPE
// ===============================
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ===============================
// MONGODB
// ===============================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.urdzboc.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  await client.connect();

  const db = client.db("book-porter-db");
  const bookCollection = db.collection("books");
  const orderCollection = db.collection("orders");
  const userCollection = db.collection("users");
  const invoiceCollection = db.collection("invoices");

  console.log("✅ MongoDB connected");

  // =====================================================
  // USERS
  // =====================================================
  app.post("/users", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).send({ message: "Email required" });

    const user = await userCollection.findOne({ email });
    if (user) return res.send(user);

    const newUser = { email, role: "user", createdAt: new Date() };
    const result = await userCollection.insertOne(newUser);
    res.send({ _id: result.insertedId, ...newUser });
  });

  app.get("/users", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).send({ message: "Email required" });

    let user = await userCollection.findOne({ email });
    if (!user) {
      user = { email, role: "user", createdAt: new Date() };
      await userCollection.insertOne(user);
    }
    res.send(user);
  });

  // =====================================================
  // BOOKS
  // =====================================================
  app.get("/books", async (req, res) => {
    const { email, status } = req.query;
    const query = {};
    if (email) query.librarianEmail = email;
    if (status) query.status = status;

    const books = await bookCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(books);
  });

  app.get("/books/:id", async (req, res) => {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid book id" });

    const book = await bookCollection.findOne({ _id: new ObjectId(id) });
    if (!book) return res.status(404).send({ message: "Book not found" });

    res.send(book);
  });

  app.post("/books", async (req, res) => {
    const book = req.body;
    if (!book.librarianEmail)
      return res.status(400).send({ message: "librarianEmail required" });

    const newBook = {
      title: book.title,
      author: book.author,
      category: book.category,
      price: Number(book.price) || 0,
      image: book.image,
      librarianEmail: book.librarianEmail,
      status: "pending",
      createdAt: new Date(),
    };

    const result = await bookCollection.insertOne(newBook);
    res.send({ _id: result.insertedId, ...newBook });
  });

  // =====================================================
  // ORDERS
  // =====================================================
  app.post("/orders", async (req, res) => {
    const { bookId, userEmail, phone, address } = req.body;

    if (!ObjectId.isValid(bookId))
      return res.status(400).send({ message: "Invalid book id" });

    const book = await bookCollection.findOne({
      _id: new ObjectId(bookId),
    });
    if (!book) return res.status(404).send({ message: "Book not found" });

    const order = {
      bookId: book._id,
      bookTitle: book.title,
      amount: book.price,
      librarianEmail: book.librarianEmail,
      userEmail,
      phone,
      address,
      status: "pending",
      paymentStatus: "unpaid",
      createdAt: new Date(),
    };

    const result = await orderCollection.insertOne(order);
    res.send({ _id: result.insertedId, ...order });
  });

  app.get("/orders", async (req, res) => {
    const { email } = req.query;

    const orders = await orderCollection
      .find({ userEmail: email })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(orders);
  });

  // =====================================================
  // STRIPE CHECKOUT
  // =====================================================
  app.post("/create-checkout-session", async (req, res) => {
    const { orderId } = req.body;

    if (!ObjectId.isValid(orderId))
      return res.status(400).send({ message: "Invalid order id" });

    const order = await orderCollection.findOne({
      _id: new ObjectId(orderId),
    });
    if (!order) return res.status(404).send({ message: "Order not found" });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: order.bookTitle },
            unit_amount: Math.round(order.amount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        orderId: order._id.toString(), // 🔥 VERY IMPORTANT
      },
      success_url: `http://localhost:5173/dashboard/payment-success`,
      cancel_url: `http://localhost:5173/dashboard/payment-cancel`,
    });

    res.send({ url: session.url });
  });

  // =====================================================
  // STRIPE WEBHOOK (🔥 REAL PAYMENT CONFIRM)
  // =====================================================
  app.post("/stripe-webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook error:", err.message);
      return res.status(400).send("Webhook Error");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const orderId = session.metadata.orderId;

      const order = await orderCollection.findOne({
        _id: new ObjectId(orderId),
      });

      if (order && order.paymentStatus !== "paid") {
        await orderCollection.updateOne(
          { _id: order._id },
          {
            $set: {
              paymentStatus: "paid",
              transactionId: session.payment_intent,
              paidAt: new Date(),
            },
          }
        );

        await invoiceCollection.insertOne({
          orderId: order._id,
          userEmail: order.userEmail,
          paymentId: session.payment_intent,
          amount: order.amount,
          bookTitle: order.bookTitle,
          paymentDate: new Date(),
          createdAt: new Date(),
        });
      }
    }

    res.json({ received: true });
  });

  // =====================================================
  // INVOICES
  // =====================================================
  app.get("/invoices", async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).send({ message: "Email required" });

    const invoices = await invoiceCollection
      .find({ userEmail: email })
      .sort({ paymentDate: -1 })
      .toArray();

    res.send(invoices);
  });
}

run().catch(console.dir);

// ===============================
// ROOT
// ===============================
app.get("/", (req, res) => {
  res.send("🚀 BookCourier Server Running");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
