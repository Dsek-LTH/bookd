CREATE TABLE bookables (
    id SERIAL primary key,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    bookable_type TEXT NOT NULL
);
CREATE TABLE bookings (
    id SERIAL primary key,
    title TEXT NOT NULL,
    booker_id TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    accepted BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE bookable_bookings (
    bookable_id INT NOT NULL REFERENCES bookables(id),
    booking_id INT NOT NULL REFERENCES bookings(id),
    PRIMARY KEY (booking_id, bookable_id)
);
