const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 3000;

// ===============================
// MIDDLEWARE
// ===============================
app.use(cors());
app.use(express.json());

// ===============================
// MONGODB CONNECTION
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
      const limit = parseInt(req.query.limit) || 0;

      const books = await bookCollection
        .find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      res.send(books);
    });

    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: "Invalid book id" });

      const book = await bookCollection.findOne({ _id: new ObjectId(id) });
      if (!book) return res.status(404).send({ message: "Book not found" });

      res.send(book);
    });

    app.post("/books", async (req, res) => {
      const book = req.body;

      const newBook = {
        ...book,
        price: Number(book.price) || 0,
        status: book.status || "published",
        createdAt: new Date(),
      };

      const result = await bookCollection.insertOne(newBook);
      res.send(result);
    });

    app.patch("/books/:id", async (req, res) => {
      const id = req.params.id;

      const updated = await bookCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { ...req.body, updatedAt: new Date() } },
        { returnDocument: "after" }
      );

      res.send(updated.value);
    });

    app.delete("/books/:id", async (req, res) => {
      const id = req.params.id;
      const result = await bookCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // ===============================
    // ORDER APIs
    // ===============================
    app.post("/orders", async (req, res) => {
      const { bookId, userEmail, phone, address } = req.body;

      const book = await bookCollection.findOne({
        _id: new ObjectId(bookId),
      });

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
    });

    app.get("/orders", async (req, res) => {
      const email = req.query.email;

      const orders = await orderCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(orders);
    });

    app.get("/orders/:id", async (req, res) => {
      const order = await orderCollection.findOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(order);
    });

    // ===============================
    // STRIPE CHECKOUT SESSION
    // ===============================
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { orderId } = req.body;

        const order = await orderCollection.findOne({
          _id: new ObjectId(orderId),
        });

        if (!order) {
          return res.status(404).send({ message: "Order not found" });
        }

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: order.bookTitle,
                },
                unit_amount: Math.round(order.amount * 100),
              },
              quantity: 1,
            },
          ],
          success_url: `${process.env.CLIENT_URL}/dashboard/payment-success?orderId=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_URL}/dashboard/payment-cancel`,
        });

        res.send({ url: session.url });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    // ===============================
    // PAYMENT SAVE (FIXED FOR INVOICES)
    // ===============================
    app.post("/payments", async (req, res) => {
      try {
        const { orderId, transactionId } = req.body;

        const order = await orderCollection.findOne({
          _id: new ObjectId(orderId),
        });

        if (!order) {
          return res.status(404).send({ message: "Order not found" });
        }

        const payment = {
          orderId: new ObjectId(orderId),
          userEmail: order.userEmail,
          amount: order.amount,

          // ✅ FRONTEND MATCH
          paymentId: transactionId,
          paymentDate: new Date(),
          bookTitle: order.bookTitle,

          createdAt: new Date(),
        };

        await paymentCollection.insertOne(payment);

        await orderCollection.updateOne(
          { _id: new ObjectId(orderId) },
          {
            $set: {
              paymentStatus: "paid",
              paymentDate: new Date(),
            },
          }
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
      const email = req.query.email;

      const invoices = await paymentCollection
        .find({ userEmail: email })
        .sort({ paymentDate: -1 })
        .toArray();

      res.send(invoices);
    });

    // ===============================
    // USERS
    // ===============================
    app.get("/users", async (req, res) => {
      const email = req.query.email;

      let user = await userCollection.findOne({ email });

      if (!user) {
        user = {
          email,
          name: "Demo User",
          createdAt: new Date(),
        };
        await userCollection.insertOne(user);
      }

      res.send(user);
    });
  } finally {
    // keep connection alive
  }
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
