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

    // ✅ GET BOOKS (latest + limit)
    // /books?limit=6&status=published
    // /books?limit=20&status=published
    app.get("/books", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 0;
        const status = req.query.status || "published";

        const query = { status };

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

        // 🔥 prevent server crash
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

    // ✅ POST BOOK (Add)
    app.post("/books", async (req, res) => {
      try {
        const book = req.body;

        const newBook = {
          ...book,
          status: book.status || "published",
          createdAt: new Date(),
        };

        const result = await bookCollection.insertOne(newBook);
        res.send(result);
      } catch (error) {
        console.error("POST /books error:", error);
        res.status(500).send({ message: "Failed to add book" });
      }
    });

    // ✅ DELETE BOOK
    app.delete("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;

        // 🔥 prevent server crash
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
