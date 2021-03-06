import { HasRoleDirective, IsAuthenticatedDirective } from "@dsek/graphql-auth-directives-unsigned";
import * as express from "express";
import * as graphqlHTTP from "express-graphql";
import { buildSchema, graphql } from "graphql";
import {
      GraphQLDate,
      GraphQLDateTime,
      GraphQLTime,
} from "graphql-iso-date";
import { makeExecutableSchema } from "graphql-tools";
import { IncomingMessage } from "http";
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

process.env.AUTH_DIRECTIVES_ROLE_TYPE = "BookingRole";
const schemaDirectives = {
    hasRole: HasRoleDirective,
    isAuthenticated: IsAuthenticatedDirective,
};

const typeDefs = `
scalar DateTime

directive @isAuthenticated on OBJECT | FIELD_DEFINITION
directive @hasRole(roles: [BookingRole]) on OBJECT | FIELD_DEFINITION

enum BookingRole {
  TEST_PERMISSION
}

type Mutation {
  addBooking(title: String!, start_time: DateTime!,
    end_time: DateTime!, item_ids: [Int!]!
  ): Booking
  @isAuthenticated,

  "For accepting a booking. Can also unaccept by setting 'accept' to false"
  setAccepted(id: Int!, accept: Boolean! = true): Booking
  @hasRole(roles: [TEST_PERMISSION]),
}
type Query {
  bookings(page: Int, maxItems: Int): [Booking!]!,
  activeBookings(page: Int, maxItems: Int): [Booking!]!,
  acceptedBookings(page: Int = 0, maxItems: Int = 20): [Booking!]!,
  facilities(page: Int = 0, maxItems: Int = 20): [Bookable!]!,
  inventories(page: Int = 0, maxItems: Int = 20): [Bookable!]!,
  bookables(page: Int = 0, maxItems: Int = 20): [Bookable!]!,
}

type Booking {
  id: Int!,
  title: String!
  items: [Bookable!]!,
  start_time: DateTime!,
  end_time: DateTime!,
  booker_id: String!,
  accepted: Boolean!,
}

type Bookable {
  id: Int!,
  title: String!,
  description: String!,
  bookings: [Booking!]!,
  bookable_type: String!,
}
schema {
  query: Query
  mutation: Mutation
}
`;

interface IBooking {
    id: number;
    title: string;
    items: IBookable[];
    start_time: string;
    end_time: string;
    booker_id: string;
    accepted: boolean;
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

type User = {
    userid: string,
    permissions: string[],
};

const insertBooking = (_: any, args: BookingInput, ctx: {user: User}): Promise<IBooking[]> => {
    const {title, start_time, end_time, item_ids} = args;
    const bookerId = ctx.user.userid;
    return queryPromise(`
        INSERT INTO bookings (title, booker_id, start_time, end_time)
        VALUES ($1, $2, $3, $4)
        RETURNING *;`, [title, bookerId, start_time, end_time])
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

const acceptBooking = (_: any, args: {id: number, accept: boolean}): Promise<IBooking> => {
    const {id, accept} = args;
    return queryPromise(`
        UPDATE bookings
        SET accepted = $1
        WHERE id = $2
        RETURNING *;`, [accept, id])
    .then((results: pg.QueryResult) => {
        if (results.rows.length < 1) { throw new Error("Update failed"); }
        return results.rows[0];
    });
};

const getBookings = (_: any, args: Paging): Promise<IBooking[]> => {
    const {page, maxItems} = args;
    return new Promise((resolve: any, reject: any) => pool.query(`
    SELECT id, title, booker_id, start_time, end_time, accepted
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

const getAcceptedBookings = (_: any, args: Paging): Promise<IBooking[]> => {
    const {page, maxItems} = args;
    return new Promise((resolve: any, reject: any) => pool.query(`
    SELECT id, title, booker_id, start_time, end_time, accepted
    FROM bookings
    WHERE accepted = true
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

const getBookables = (_: any, args: Paging): Promise<IBookable[]> => {
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

const resolvers = {
    Bookable: {
        bookings: getBookableBookings,
    },
    Booking: {
        items: getBookingItems,
    },
    DateTime: GraphQLDateTime,
    Mutation: {
        addBooking: insertBooking,
        setAccepted: acceptBooking,
    },
    Query: {
        acceptedBookings: getAcceptedBookings,
        bookables: getBookables,
        bookings: getBookings,
        facilities: (_: any, args: Paging) => getBookablesOfType("lokal", args),
        inventories: (_: any, args: Paging) => getBookablesOfType("inventarie", args),
    },
};

const schema = makeExecutableSchema({
                                     resolvers,
                                     schemaDirectives,
                                     typeDefs,
});

const port = 8084;

const getUser = (req: IncomingMessage) => {
    const userHeader = req.headers["dsek-user"] as string; // should never be string[] (??)
    return userHeader && JSON.parse(userHeader);
};

const app = express();
app.use("/graphql", graphqlHTTP((req: IncomingMessage) => {
    const user = getUser(req);
    const roles = user && user.permissions;
    console.log("user", user);
    return {
        context: {
            roles,
            user,
        },
        graphiql: process.env.NODE_ENV === "development",
        schema,
    };
}));
app.listen(port, () => console.log(`login service listening on port ${port}`));
