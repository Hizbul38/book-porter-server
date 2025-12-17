const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

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

    console.log("✅ MongoDB connected");

    // =====================================================
    // USERS APIs (🔥 MOST IMPORTANT)
    // =====================================================

    // 🔹 CREATE USER (REGISTER / LOGIN)
    app.post("/users", async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const existingUser = await userCollection.findOne({ email });

      if (existingUser) {
        return res.send(existingUser);
      }

      const newUser = {
        email,
        role: "user",
        createdAt: new Date(),
      };

      const result = await userCollection.insertOne(newUser);

      res.send({ _id: result.insertedId, ...newUser });
    });

    // 🔹 GET USER (AUTO CREATE IF NOT EXISTS)
    app.get("/users", async (req, res) => {
      const email = req.query.email;

      if (!email) {
        return res.status(400).send({ message: "Email required" });
      }

      let user = await userCollection.findOne({ email });

      if (!user) {
        user = {
          email,
          role: "user",
          createdAt: new Date(),
        };
        await userCollection.insertOne(user);
      }

      res.send(user);
    });

    // 🔹 GET ALL USERS (ADMIN)
    app.get("/users/all", async (req, res) => {
      const users = await userCollection
        .find({})
        .sort({ createdAt: -1 })
        .toArray();

      res.send(users);
    });

    // 🔹 UPDATE USER ROLE (ADMIN)
    app.patch("/users/role/:id", async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      const allowedRoles = ["user", "librarian", "admin"];

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid user id" });
      }

      if (!allowedRoles.includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }

      const result = await userCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        {
          $set: {
            role,
            roleUpdatedAt: new Date(),
          },
        },
        { returnDocument: "after" }
      );

      if (!result.value) {
        return res.status(404).send({ message: "User not found" });
      }

      res.send(result.value);
    });

    // =====================================================
    // BOOK APIs
    // =====================================================

    // ALL BOOKS / LIBRARIAN BOOKS
    app.get("/books", async (req, res) => {
      const email = req.query.email;
      const query = email ? { librarianEmail: email } : {};

      const books = await bookCollection
        .find(query)
        .sort({ createdAt: -1 })
        .toArray();

      res.send(books);
    });

    // SINGLE BOOK
    app.get("/books/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id" });
      }

      const book = await bookCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!book) {
        return res.status(404).send({ message: "Book not found" });
      }

      res.send(book);
    });

    // ADD BOOK (LIBRARIAN → PENDING)
    app.post("/books", async (req, res) => {
      const book = req.body;

      if (!book.librarianEmail) {
        return res
          .status(400)
          .send({ message: "librarianEmail is required" });
      }

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

    // UPDATE BOOK (ADMIN / LIBRARIAN)
    app.patch("/books/:id", async (req, res) => {
      const { id } = req.params;
      const allowedStatus = ["published", "unpublished", "pending"];

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id" });
      }

      const updateFields = {};

      if (req.body.title !== undefined)
        updateFields.title = req.body.title;
      if (req.body.author !== undefined)
        updateFields.author = req.body.author;
      if (req.body.category !== undefined)
        updateFields.category = req.body.category;
      if (req.body.price !== undefined)
        updateFields.price = Number(req.body.price);
      if (req.body.image !== undefined)
        updateFields.image = req.body.image;

      if (
        req.body.status !== undefined &&
        allowedStatus.includes(req.body.status)
      ) {
        updateFields.status = req.body.status;
      }

      if (Object.keys(updateFields).length === 0) {
        return res
          .status(400)
          .send({ message: "No valid fields to update" });
      }

      updateFields.updatedAt = new Date();

      const result = await bookCollection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updateFields },
        { returnDocument: "after" }
      );

      if (!result.value) {
        return res.status(404).send({ message: "Book not found" });
      }

      res.send(result.value);
    });

    // DELETE BOOK (ADMIN)
    app.delete("/books/:id", async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: "Invalid book id" });
      }

      const bookDeleteResult = await bookCollection.deleteOne({
        _id: new ObjectId(id),
      });

      const orderDeleteResult = await orderCollection.deleteMany({
        bookId: new ObjectId(id),
      });

      res.send({
        bookDeleted: bookDeleteResult.deletedCount,
        ordersDeleted: orderDeleteResult.deletedCount,
      });
    });

    // =====================================================
    // ORDER APIs
    // =====================================================
    app.post("/orders", async (req, res) => {
      const { bookId, userEmail, phone, address } = req.body;

      if (!ObjectId.isValid(bookId)) {
        return res.status(400).send({ message: "Invalid book id" });
      }

      const book = await bookCollection.findOne({
        _id: new ObjectId(bookId),
      });

      if (!book) {
        return res.status(404).send({ message: "Book not found" });
      }

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
      res.send({ _id: result.insertedId, ...order });
    });

    app.get("/orders", async (req, res) => {
      const email = req.query.email;

      const orders = await orderCollection
        .find({ userEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

      res.send(orders);
    });
  } finally {
    // keep alive
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
