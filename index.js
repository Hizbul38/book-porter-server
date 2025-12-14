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
    const userCollection = db.collection("users"); // profile

    // =====================================
    // ✅ BOOKS APIs
    // =====================================

    // ✅ GET BOOKS
    // /books?limit=6&status=published
    // /books?status=all
    app.get("/books", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 0;
        const status = req.query.status || "published";

        // status field na thakleo published hishebe count korbe
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

    // ✅ GET SINGLE BOOK
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

    // ✅ POST BOOK (Add) -> librarianEmail save + return full saved book
    app.post("/books", async (req, res) => {
      try {
        const book = req.body;

        if (!book?.title || !book?.author || !book?.img || book?.price == null) {
          return res
            .status(400)
            .send({ message: "title, author, img, price required" });
        }

        const newBook = {
          ...book,
          status: book.status || "published",
          price: Number(book.price) || 0,
          librarianEmail: book.librarianEmail || "",
          createdAt: new Date(),
        };

        const result = await bookCollection.insertOne(newBook);

        const savedBook = await bookCollection.findOne({
          _id: result.insertedId,
        });

        res.status(201).send(savedBook);
      } catch (error) {
        console.error("POST /books error:", error);
        res.status(500).send({ message: "Failed to add book" });
      }
    });

    // ✅ UPDATE BOOK (Edit)
    // PATCH /books/:id
    app.patch("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid book id" });

        const updatedFields = req.body || {};

        const updated = await bookCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...updatedFields,
              ...(updatedFields.price != null
                ? { price: Number(updatedFields.price) || 0 }
                : {}),
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" }
        );

        if (!updated.value)
          return res.status(404).send({ message: "Book not found" });

        res.send(updated.value);
      } catch (error) {
        console.error("PATCH /books/:id error:", error);
        res.status(500).send({ message: "Failed to update book" });
      }
    });

    // ✅ DELETE BOOK (keeping - if you don't want delete, remove this route)
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

    // ✅ GET LIBRARIAN BOOKS
    // /librarian/books?email=librarian@bookcourier.com
    app.get("/librarian/books", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res.status(400).send({ message: "email query is required" });

        const books = await bookCollection
          .find({ librarianEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(books);
      } catch (error) {
        console.error("GET /librarian/books error:", error);
        res.status(500).send({ message: "Failed to get librarian books" });
      }
    });

    // =====================================
    // ✅ ORDERS APIs (User + Librarian)
    // =====================================

    // ✅ CREATE ORDER -> supports bookId as string or ObjectId
    // returns full saved order (with librarianEmail snapshot)
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

        const bookIdStr = String(order.bookId);
        if (!ObjectId.isValid(bookIdStr)) {
          return res.status(400).send({ message: "Invalid bookId" });
        }

        const book = await bookCollection.findOne({
          _id: new ObjectId(bookIdStr),
        });
        if (!book) return res.status(404).send({ message: "Book not found" });

        const newOrder = {
          // ✅ store both for safety (old data issues solve)
          bookId: new ObjectId(bookIdStr),
          bookIdStr: bookIdStr,

          bookTitle: book.title,
          amount: Number(book.price) || 0,

          librarianEmail: book.librarianEmail || "",

          userEmail: order.userEmail,
          phone: order.phone,
          address: order.address,

          status: "pending", // pending | shipped | delivered | cancelled
          paymentStatus: "unpaid", // unpaid | paid
          createdAt: new Date(),
        };

        const result = await orderCollection.insertOne(newOrder);

        const savedOrder = await orderCollection.findOne({
          _id: result.insertedId,
        });

        res.status(201).send(savedOrder);
      } catch (error) {
        console.error("POST /orders error:", error);
        res.status(500).send({ message: "Failed to create order" });
      }
    });

    // ✅ GET MY ORDERS (user)
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

    // ✅ GET SINGLE ORDER (payment page)
    app.get("/orders/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid order id" });

        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).send({ message: "Order not found" });

        res.send(order);
      } catch (error) {
        console.error("GET /orders/:id error:", error);
        res.status(500).send({ message: "Failed to get order" });
      }
    });

    // ✅ USER CANCEL ORDER (only pending)
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

    // ✅ GET LIBRARIAN ORDERS (FIXED: works even if old orders had bookId string/ObjectId)
    // /librarian/orders?email=librarian@bookcourier.com
    app.get("/librarian/orders", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res.status(400).send({ message: "email query is required" });

        // 1) librarian er added books _id list
        const myBooks = await bookCollection
          .find({ librarianEmail: email })
          .project({ _id: 1 })
          .toArray();

        const myBookObjectIds = myBooks.map((b) => b._id);
        const myBookStringIds = myBooks.map((b) => String(b._id));

        // 2) orders match by:
        // - librarianEmail snapshot
        // - bookId (ObjectId)
        // - bookIdStr (string)
        // - legacy bookId string (if someone stored it as string in bookId)
        const query = {
          $or: [
            { librarianEmail: email },
            ...(myBookObjectIds.length ? [{ bookId: { $in: myBookObjectIds } }] : []),
            ...(myBookStringIds.length ? [{ bookIdStr: { $in: myBookStringIds } }] : []),
            ...(myBookStringIds.length ? [{ bookId: { $in: myBookStringIds } }] : []),
          ],
        };

        const orders = await orderCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(orders);
      } catch (error) {
        console.error("GET /librarian/orders error:", error);
        res.status(500).send({ message: "Failed to get librarian orders" });
      }
    });

    // ✅ LIBRARIAN CANCEL ORDER (delivered হলে cancel না)
    // PATCH /orders/:id/librarian-cancel
    app.patch("/orders/:id/librarian-cancel", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid order id" });

        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).send({ message: "Order not found" });

        if (order.status === "delivered") {
          return res
            .status(400)
            .send({ message: "Delivered order cannot be cancelled" });
        }

        const updated = await orderCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { status: "cancelled" } },
          { returnDocument: "after" }
        );

        res.send(updated.value);
      } catch (error) {
        console.error("PATCH /orders/:id/librarian-cancel error:", error);
        res.status(500).send({ message: "Failed to cancel order" });
      }
    });

    // ✅ LIBRARIAN UPDATE ORDER STATUS (pending->shipped->delivered)
    // PATCH /orders/:id/status { status: "shipped" | "delivered" }
    app.patch("/orders/:id/status", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid order id" });

        const { status } = req.body || {};
        if (!status || !["shipped", "delivered"].includes(status)) {
          return res
            .status(400)
            .send({ message: "status must be shipped or delivered" });
        }

        const order = await orderCollection.findOne({ _id: new ObjectId(id) });
        if (!order) return res.status(404).send({ message: "Order not found" });

        if (order.status === "cancelled") {
          return res
            .status(400)
            .send({ message: "Cancelled order cannot be updated" });
        }

        if (status === "shipped" && order.status !== "pending") {
          return res
            .status(400)
            .send({ message: "Only pending -> shipped allowed" });
        }

        if (status === "delivered" && order.status !== "shipped") {
          return res
            .status(400)
            .send({ message: "Only shipped -> delivered allowed" });
        }

        const updated = await orderCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: { status } },
          { returnDocument: "after" }
        );

        res.send(updated.value);
      } catch (error) {
        console.error("PATCH /orders/:id/status error:", error);
        res.status(500).send({ message: "Failed to update order status" });
      }
    });

    // =====================================
    // ✅ INVOICES APIs (paid payments list)
    // =====================================

    // GET /invoices?email=user@email.com
    app.get("/invoices", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res.status(400).send({ message: "email query is required" });

        const invoices = await orderCollection
          .find({
            userEmail: email,
            paymentStatus: "paid",
            paymentId: { $exists: true },
          })
          .sort({ paymentDate: -1 })
          .project({
            bookTitle: 1,
            amount: 1,
            paymentId: 1,
            paymentDate: 1,
          })
          .toArray();

        res.send(invoices);
      } catch (error) {
        console.error("GET /invoices error:", error);
        res.status(500).send({ message: "Failed to get invoices" });
      }
    });

    // =====================================
    // ✅ USERS APIs (My Profile)
    // =====================================

    // GET /users?email=demo@bookcourier.com
    app.get("/users", async (req, res) => {
      try {
        const email = req.query.email;
        if (!email)
          return res.status(400).send({ message: "email query is required" });

        let user = await userCollection.findOne({ email });

        if (!user) {
          const newUser = {
            email,
            name: "Demo User",
            photoURL: "",
            createdAt: new Date(),
          };
          const result = await userCollection.insertOne(newUser);
          user = await userCollection.findOne({ _id: result.insertedId });
        }

        res.send(user);
      } catch (error) {
        console.error("GET /users error:", error);
        res.status(500).send({ message: "Failed to get user profile" });
      }
    });

    // PATCH /users/:id  { name, photoURL }
    app.patch("/users/:id", async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id))
          return res.status(400).send({ message: "Invalid user id" });

        const { name, photoURL } = req.body || {};
        if (!name && !photoURL) {
          return res.status(400).send({ message: "name or photoURL required" });
        }

        const updated = await userCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          {
            $set: {
              ...(name ? { name } : {}),
              ...(photoURL ? { photoURL } : {}),
              updatedAt: new Date(),
            },
          },
          { returnDocument: "after" }
        );

        res.send(updated.value);
      } catch (error) {
        console.error("PATCH /users/:id error:", error);
        res.status(500).send({ message: "Failed to update profile" });
      }
    });

    // Ping
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}

run().catch(console.dir);

// root
app.get("/", (req, res) => {
  res.send("Welcome to Book Porter!");
});

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
