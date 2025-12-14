const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

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

    // =====================================
    // ✅ BOOKS APIs
    // =====================================

    // ✅ GET BOOKS (latest + limit)
    // /books?limit=6&status=published
    // /books?limit=20&status=published
    // /books?status=all
    app.get("/books", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 0;
        const status = req.query.status || "published";

        // ✅ status field na thakleo published hishebe count korbe
        const query =
          status === "all"
            ? {}
            : { $or: [{ status }, { status: { $exists: false } }] };

        const books = await bookCollection
          .find(query)
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();

        res.send(books);
      } catch (error) {
        console.error("GET /books error:", error);
        res.status(500).send({ message: "Failed to get books" });
      }
    });

    // ✅ GET SINGLE BOOK (Book Details)
    app.get("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid book id" });
        }

        const book = await bookCollection.findOne({ _id: new ObjectId(id) });

        if (!book) {
          return res.status(404).send({ message: "Book not found" });
        }

        res.send(book);
      } catch (error) {
        console.error("GET /books/:id error:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // ✅ POST BOOK (Add) -> return full saved book
    app.post("/books", async (req, res) => {
      try {
        const book = req.body;

        const newBook = {
          ...book,
          status: book.status || "published",
          createdAt: new Date(),
        };

        const result = await bookCollection.insertOne(newBook);

        // ✅ return full saved book object (latest section + all books instant use)
        const savedBook = await bookCollection.findOne({
          _id: result.insertedId,
        });

        res.status(201).send(savedBook);
      } catch (error) {
        console.error("POST /books error:", error);
        res.status(500).send({ message: "Failed to add book" });
      }
    });

    // ✅ DELETE BOOK
    app.delete("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid book id" });
        }

        const result = await bookCollection.deleteOne({
          _id: new ObjectId(id),
        });

        res.send(result);
      } catch (error) {
        console.error("DELETE /books/:id error:", error);
        res.status(500).send({ message: "Failed to delete book" });
      }
    });

    // =====================================
    // ✅ ORDERS APIs (User Order Now)
    // =====================================

    // ✅ CREATE ORDER -> return full saved order
    // POST /orders
    app.post("/orders", async (req, res) => {
      try {
        const order = req.body;

        if (
          !order?.bookId ||
          !order?.userEmail ||
          !order?.phone ||
          !order?.address
        ) {
          return res.status(400).send({
            message: "bookId, userEmail, phone, address are required",
          });
        }

        if (!ObjectId.isValid(order.bookId)) {
          return res.status(400).send({ message: "Invalid bookId" });
        }

        const book = await bookCollection.findOne({
          _id: new ObjectId(order.bookId),
        });
        if (!book) return res.status(404).send({ message: "Book not found" });

        const newOrder = {
          bookId: new ObjectId(order.bookId),
          bookTitle: book.title,
          amount: Number(book.price) || 0,

          userEmail: order.userEmail,
          phone: order.phone,
          address: order.address,

          status: "pending",
          paymentStatus: "unpaid",
          createdAt: new Date(),
        };

        const result = await orderCollection.insertOne(newOrder);

        // ✅ return full saved order object
        const savedOrder = await orderCollection.findOne({
          _id: result.insertedId,
        });

        res.status(201).send(savedOrder);
      } catch (error) {
        console.error("POST /orders error:", error);
        res.status(500).send({ message: "Failed to create order" });
      }
    });

    // ✅ GET MY ORDERS
    // GET /orders?email=someone@email.com
    app.get("/orders", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res.status(400).send({ message: "email query is required" });

        const orders = await orderCollection
          .find({ userEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(orders);
      } catch (error) {
        console.error("GET /orders error:", error);
        res.status(500).send({ message: "Failed to get orders" });
      }
    });

    // ✅ CANCEL ORDER (only pending) -> return updated order
    // PATCH /orders/:id/cancel
    app.patch("/orders/:id/cancel", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid order id" });

        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).send({ message: "Order not found" });

        if (order.status !== "pending") {
          return res
            .status(400)
            .send({ message: "Only pending orders can be cancelled" });
        }

        const updated = await orderCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { status: "cancelled" } },
          { returnDocument: "after" }
        );

        res.send(updated.value);
      } catch (error) {
        console.error("PATCH /orders/:id/cancel error:", error);
        res.status(500).send({ message: "Failed to cancel order" });
      }
    });

    // ✅ PAY ORDER (demo) -> return updated order
    // POST /orders/:id/pay
    app.post("/orders/:id/pay", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid order id" });

        const paymentId = req.body?.paymentId || `PAY-${Date.now()}`;

        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).send({ message: "Order not found" });

        if (order.status === "cancelled") {
          return res
            .status(400)
            .send({ message: "Cancelled order cannot be paid" });
        }

        const updated = await orderCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          {
            $set: {
              paymentStatus: "paid",
              paymentId,
              paymentDate: new Date(),
            },
          },
          { returnDocument: "after" }
        );

        res.send(updated.value);
      } catch (error) {
        console.error("POST /orders/:id/pay error:", error);
        res.status(500).send({ message: "Failed to pay order" });
      }
    });

    // Ping to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

// root route
app.get("/", (req, res) => {
  res.send("Welcome to Book Porter!");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
