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

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
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

    // =====================================
    // ✅ GET BOOKS (Home latest 6 / All books 20)
    // Example:
    //   /books?limit=6&status=published
    //   /books?limit=20&status=published
    // =====================================
    app.get("/books", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 0;
        const status = req.query.status || "published";

        const query = { status };

        const books = await bookCollection
          .find(query)
          .sort({ createdAt: -1 }) // latest first
          .limit(limit)
          .toArray();

        res.send(books);
      } catch (error) {
        res.status(500).send({ message: "Failed to get books" });
      }
    });

    // =====================================
    // ✅ GET SINGLE BOOK (Book Details page)
    // Example: /books/64b....
    // =====================================
    app.get("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const book = await bookCollection.findOne({ _id: new ObjectId(id) });

        if (!book) {
          return res.status(404).send({ message: "Book not found" });
        }

        res.send(book);
      } catch (error) {
        res.status(500).send({ message: "Failed to get book" });
      }
    });

    // =====================================
    // ✅ POST BOOK (Add book)
    // createdAt + default status add করা হলো
    // =====================================
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
        res.status(500).send({ message: "Failed to add book" });
      }
    });

    // =====================================
    // ✅ DELETE BOOK (Admin)
    // Example: DELETE /books/:id
    // =====================================
    app.delete("/books/:id", async (req, res) => {
      try {
        const id = req.params.id;

        const result = await bookCollection.deleteOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to delete book" });
      }
    });

    // Ping to confirm connection
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close(); // keep commented for production dev server
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
