const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.urdzboc.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("book-porter-db");

    const bookCollection = db.collection("books");
    const orderCollection = db.collection("orders");
    const userCollection = db.collection("users");
    const paymentCollection = db.collection("payments");

    console.log("✅ MongoDB connected");

    // ===============================
    // BOOK APIs
    // ===============================
    app.get("/books", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 0;
        const status = req.query.status || "published";
        const query = status === "all" ? {} : { $or: [{ status }, { status: { $exists: false } }] };
        const books = await bookCollection.find(query).sort({ createdAt: -1 }).limit(limit).toArray();
        res.send(books);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid book id" });
        const book = await bookCollection.findOne({ _id: new ObjectId(id) });
        if (!book) return res.status(404).send({ message: "Book not found" });
        res.send(book);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.post("/books", async (req, res) => {
      try {
        const book = req.body;
        const newBook = { ...book, price: Number(book.price) || 0, status: book.status || "published", createdAt: new Date() };
        const result = await bookCollection.insertOne(newBook);
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.patch("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const updated = await bookCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { ...req.body, updatedAt: new Date() } },
          { returnDocument: "after" }
        );
        res.send(updated.value);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.delete("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const result = await bookCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ===============================
    // ORDER APIs
    // ===============================
    app.post("/orders", async (req, res) => {
      try {
        const { bookId, userEmail, phone, address } = req.body;
        const book = await bookCollection.findOne({ _id: new ObjectId(bookId) });
        if (!book) return res.status(404).send({ message: "Book not found" });

        const order = {
          bookId: new ObjectId(bookId),
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
        res.send(result);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get("/orders", async (req, res) => {
      try {
        const email = req.query.email;
        const orders = await orderCollection.find({ userEmail: email }).sort({ createdAt: -1 }).toArray();
        res.send(orders);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.get("/orders/:id", async (req, res) => {
      try {
        const order = await orderCollection.findOne({ _id: new ObjectId(req.params.id) });
        res.send(order);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ===============================
    // STRIPE PAYMENT APIs
    // ===============================
    app.post("/create-payment-intent", async (req, res) => {
      try {
        const { price } = req.body;
        const amount = Math.round(price * 100); // convert to cents
        const paymentIntent = await stripe.paymentIntents.create({ amount, currency: "usd", payment_method_types: ["card"] });
        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.post("/payments", async (req, res) => {
      try {
        const { orderId, email, amount, transactionId } = req.body;

        const payment = { orderId: new ObjectId(orderId), userEmail: email, amount, transactionId, createdAt: new Date() };
        await paymentCollection.insertOne(payment);

        await orderCollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { paymentStatus: "paid", paymentId: transactionId, paymentDate: new Date() } }
        );

        res.send({ success: true });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ===============================
    // INVOICES
    // ===============================
    app.get("/invoices", async (req, res) => {
      try {
        const email = req.query.email;
        const invoices = await paymentCollection.find({ userEmail: email }).sort({ createdAt: -1 }).toArray();
        res.send(invoices);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ===============================
    // USERS
    // ===============================
    app.get("/users", async (req, res) => {
      try {
        const email = req.query.email;
        let user = await userCollection.findOne({ email });
        if (!user) {
          const newUser = { email, name: "Demo User", createdAt: new Date() };
          await userCollection.insertOne(newUser);
          user = newUser;
        }
        res.send(user);
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });
  } finally {
    // Optional: do not close MongoDB connection here
  }
}

run().catch(console.dir);

// Root endpoint
app.get("/", (req, res) => res.send("🚀 BookCourier Server Running"));

app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
