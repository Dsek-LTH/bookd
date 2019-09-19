import * as express from "express";
import * as graphqlHTTP from "express-graphql";
import { buildSchema, graphql } from "graphql";
// import GraphQLDateTime from 'graphql-type-datetime';
import {
      GraphQLDate,
      GraphQLDateTime,
      GraphQLTime,
} from "graphql-iso-date";
// import { GraphQLScalarType } from 'graphql';
import { makeExecutableSchema } from "graphql-tools";
import * as mysql from "mysql";
import * as pg from "pg";

const schema = makeExecutableSchema({
                                     resolvers: {DateTime: GraphQLDateTime},
                                     typeDefs: `
scalar DateTime

type Query {
  bookings(page: Int, maxItems: Int): [Booking!]!,
  activeBookings(page: Int, maxItems: Int): [Booking!]!,
  facilities(page: Int, maxItems: Int): [Bookable!]!,
  inventories(page: Int, maxItems: Int): [Bookable!]!,
}

type Booking {
  title: String!
  items: [Bookable!]!,
  start_time: DateTime!,
  end_time: DateTime!,
  booker_id: String!,
}

type Bookable {
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
    start_time: Date;
    end_time: Date;
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

const pool = new pg.Pool({
    database        : process.env.PG_DATABASE,
    host            : process.env.PG_HOST,
    password        : process.env.PG_PASSWORD,
    user            : process.env.PG_USER,
});

const getBookables = (args: {page: number, maxItems: number}): Promise<IBookable[]> => {
    const {page, maxItems} = args;
    console.log("page", page);
    console.log("maxItems", maxItems);
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
                            args: {page: number, maxItems: number},
): Promise<IBookable[]> => {
    const {page, maxItems} = args;
    console.log("page", page);
    console.log("maxItems", maxItems);
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
    bookables: getBookables,
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
