// Studio Booking data access lives in the @cds/db studio chokepoint (packages/db/src/studio):
// it narrows a barber to their own seat, which the generic addonRepo cannot do (it refuses
// renters outright). The hub routes and tenant pages call it directly; this package holds no
// data code of its own.
export {};
