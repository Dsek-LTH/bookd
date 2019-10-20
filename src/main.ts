import * as express from "express";
import * as graphqlHTTP from "express-graphql";
import { buildSchema, graphql } from "graphql";
import {
      GraphQLDate,
      GraphQLDateTime,
      GraphQLTime,
} from "graphql-iso-date";
import { makeExecutableSchema } from "graphql-tools";
import * as pg from "pg";

const getBookingItems = (source: IBooking) =>
    queryPromise(`
        SELECT *
        FROM bookables
        INNER JOIN bookable_bookings ON (bookables.id = bookable_bookings.bookable_id)
        WHERE booking_id = $1`, [source.id])
    .then((results) => results.rows);

const getBookableBookings = (source: IBookable) =>
    queryPromise(`
        SELECT *
        FROM bookings
        INNER JOIN bookable_bookings ON (bookings.id = bookable_bookings.booking_id)
        WHERE bookable_id = $1`, [source.id])
    .then((results) => results.rows);

const resolvers = {
    Bookable: {
        bookings: getBookableBookings,
    },
    Booking: {
        items: getBookingItems,
    },
    DateTime: GraphQLDateTime,
};

const schema = makeExecutableSchema({
                                     resolvers,
                                     typeDefs: `
scalar DateTime

type Mutation {
  addBooking(title: String!, booker_id: String!,
    start_time: DateTime!, end_time: DateTime!, item_ids: [Int!]!
  ): Booking,
}
type Query {
  bookings(page: Int, maxItems: Int): [Booking!]!,
  activeBookings(page: Int, maxItems: Int): [Booking!]!,
  facilities(page: Int, maxItems: Int): [Bookable!]!,
  inventories(page: Int, maxItems: Int): [Bookable!]!,
}

type Booking {
  id: Int!,
  title: String!
  items: [Bookable!]!,
  start_time: DateTime!,
  end_time: DateTime!,
  booker_id: String!,
}

type Bookable {
  id: Int!,
  title: String!,
  description: String!,
  bookings: [Booking!]!,
  bookable_type: String!,
}
`,
});

interface IBooking {
    id: number;
    title: string;
    items: IBookable[];
    start_time: string;
    end_time: string;
    booker_id: string;
}

interface IBookable {
    id: number;
    title: string;
    description: string;
    bookings: IBooking[];
    bookable_type: string;
}

type Paging = {page: number, maxItems: number};
type BookingInput = {
    title: string,
    booker_id: string,
    start_time: Date,
    end_time: Date,
    item_ids: number[],
};

const pool = new pg.Pool({
    database        : process.env.PG_DATABASE,
    host            : process.env.PG_HOST,
    password        : process.env.PG_PASSWORD,
    user            : process.env.PG_USER,
});

const expand = (rowCount: number, columnCount: number, startAt: number = 1) => {
    let index = startAt;
    return Array(rowCount).fill(0).map((v) =>
      `(${Array(columnCount).fill(0).map((v2) =>
          `$${index++}`).join(", ")
      })`).join(", ");
};

const flatten = (list: any[]): any[] => list.reduce(
    (a: any, b: any) => a.concat(Array.isArray(b) ? flatten(b) : b), [],
);

const queryPromise = (query: string, values: any[]): Promise<pg.QueryResult> =>
    new Promise((resolve: any, reject: any) =>
        pool.query(query, values, (error, result) => {
            if (error) {
                return reject(error);
            } else {
                return resolve(result);
            }}));

const insertBooking = (args: BookingInput): Promise<IBooking[]> => {
    const {title, booker_id, start_time, end_time, item_ids} = args;
    return queryPromise(`
        INSERT INTO bookings (title, booker_id, start_time, end_time)
        VALUES ($1, $2, $3, $4)
        RETURNING *;`, [title, booker_id, start_time, end_time])
    .then((results: pg.QueryResult) => {
        if (results.rows.length < 1) { throw new Error("Insert failed"); }
        results.rows.forEach((value: any) => {
            console.log("value", value);
        });
        return results.rows[0];
    }).then(async (booking) => {
        const rows = item_ids.map((item) => [item, booking.id]);
        await queryPromise(`
            INSERT INTO bookable_bookings (bookable_id, booking_id)
            VALUES ${expand(item_ids.length, 2)}`, flatten(rows));
        return booking;
    });
};

const getBookings = (args: Paging): Promise<IBooking[]> => {
    const {page, maxItems} = args;
    return new Promise((resolve: any, reject: any) => pool.query(`
    SELECT id, title, booker_id, start_time, end_time
    FROM bookings
    ORDER BY title, id
    LIMIT $1 OFFSET $2;`, [maxItems, page * maxItems], (error, results) => {
        console.log("error", error);
        if (error) { return reject(error); }
        results.rows.forEach((value: any) => {
            console.log("value", value);
        });
        return resolve(results.rows);
    }),
    );
};

const getBookables = (args: Paging): Promise<IBookable[]> => {
    const {page, maxItems} = args;
    return new Promise((resolve: any, reject: any) => pool.query(`
    SELECT id, title, description, bookable_type
    FROM bookables
    ORDER BY title, id
    LIMIT $1 OFFSET $2;`, [maxItems, page * maxItems], (error, results) => {
        console.log("error", error);
        if (error) { return reject(error); }
        results.rows.forEach((value: any) => {
            console.log("value", value);
        });
        return resolve(results.rows);
    }),
    );
};

const getBookablesOfType = (bookableType: "lokal" | "inventarie",
                            args: Paging,
): Promise<IBookable[]> => {
    const {page, maxItems} = args;
    return new Promise((resolve: any, reject: any) => pool.query(`
    SELECT id, title, description, bookable_type
    FROM bookables
    WHERE bookable_type = $3
    ORDER BY title, id
    LIMIT $1 OFFSET $2;`, [maxItems, page * maxItems, bookableType], (error, results) => {
        console.log("error", error);
        if (error) { return reject(error); }
        results.rows.forEach((value: any) => {
            console.log("value", value);
        });
        return resolve(results.rows);
    }),
    );
};

const root = {
    addBooking: insertBooking,
    bookables: getBookables,
    bookings: getBookings,
    facilities: (args: Paging) => getBookablesOfType("lokal", args),
    inventories: (args: Paging) => getBookablesOfType("inventarie", args),
};

const port = 8084;

const app = express();
app.use("/graphql", graphqlHTTP({
    graphiql: process.env.NODE_ENV === "development",
    rootValue: root,
    schema,
}));
app.listen(port, () => console.log(`login service listening on port ${port}`));
