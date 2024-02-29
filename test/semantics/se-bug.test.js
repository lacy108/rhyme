const { api, pipe } = require('../../src/rhyme')
const { rh, parse } = require('../../src/parser')
const { compile } = require('../../src/simple-eval')



let data = [
    { key: "A", value: 10 },
    { key: "B", value: 20 },
    { key: "A", value: 30 }
]


// Test double-sum situations, i.e. where the
// result of one accumulation is used in another
// one.

test("scalarTest0", () => {
    let query = {
      total: api.sum(api.sum("data.*.value")),
      all: [["data.*.value"]]
    }
    let func = compile(query)
    let res = func({ data }, true)
    let expected = { total: 60, all: [[10,20,30]] }
    expect(res).toEqual(expected)
})


test("groupTest0", () => {
    let query = {
        "total": api.sum("data.*.value"),
        "data.*.key": api.sum("data.*.value")
    }
    let func = compile(query)
    let res = func({ data }, true)
    let expected = { "total": 60, "A": 40, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest1", () => {
    let query = {
        "total": api.sum("data.*.value"),
        "data.*.key": api.plus(api.sum("data.*.value"), 0)
    }
    let func = compile(query)
    let res = func({ data }, true)
    let expected = { "total": 60, "A": 40, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest2", () => { // BUG!!!
    let query = {
        "total": api.sum(api.sum("data.*.value")),
        "data.*.key": api.sum(api.sum("data.*.value"))  // XXXX !!!!
    }
    let func = compile(query)
    let res = func({ data }, true)
    let expected = { "total": 60, "A": 40, "B": 20 }
    let bug = { "total": 60, "A": 80, "B": 20 }
    expect(res).toEqual(expected)
})

test("groupTest3", () => { // BUG!!!
    let query = {
        "total": api.sum(api.sum("data.*.value")),
        "data.*.key": [([("data.*.value")])]  // XXXX !!!!
    }
    let func = compile(query)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data }, true)
    let expected = { "total": 60, "A": [[10,30]], "B": [[20]] }
    let bug = { "total": 60, "A": [[10,30],[10,30]], "B": [[20]] }
    expect(res).toEqual(expected)
})

// These simple cases above are fixed by considering if
// sum(q) actually does any dimensionality reduction.
// If not, codgen makes the sum acts as a no-op.

// Now what about cases where we're removing *some* 
// variables, but not all.


let data3 = [
    { key: "A", sub: [110, 120] }, // 230
    { key: "A", sub: [330] },
    { key: "B", sub: [200] },
]


test("groupTestNested1", () => {
    let query1 = {
        // "total": api.sum(api.sum("data3.*.sub.*B")),
        "data3.*.key": {
          // "subtotal": rh`sum (udf.guard *B (sum data3.*.sub.*B))`,
          "items": rh`array (udf.guard *B (array data3.*.sub.*B))`
        }
    }


    let func = compile(query1)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let res = func({ data3, udf: {guard: (x,y) => y }}, true)

    // console.dir(res, {depth:7})


    let expected = { 
      // "total": 760, 
      "A": {
        // "subtotal": 560, 
        items: [[110, 330], [120]],
      },
      "B": {
        // "subtotal": 200, 
        items: [[200]],
      }
    }
    let bug = { 
      // "total": 760, 
      "A": {
        // "subtotal": 1000,  // extra 110+330 !!!
        items: [[110, 330], [120], [110, 330]], // extra 110, 330 !!!
      },
      "B": {
        // "subtotal": 200, 
        items: [[200]],
      }
    }
    expect(res).toEqual(expected)  

    // NOTE: this is fixed now, albeit in a quite hacky way (so far)
    // in 'emitCode'.
})


test("groupTestNested2_encoding1", () => {
    let q0 = {"data3.*A.key": { "*A": "data3.*A" }}

    let q1 = rh`udf.guard *K (array (udf.guard *B (array ${q0}.*K.*.sub.*B)))`

    // NOTE: it's convenient to replace 'data' with 'q0.*K' in
    //   data.*.sub.*B --> q0.*K.*.sub.*B
    // but not strictly required -- we could also do something
    // like (q0.*K.*C) && (data.*C.sub.*B), i.e decouple data
    // access from key filtering.  ----> see test case below!
    //
    // Ultimately it's a choice between indexing each variable
    // (i.e. *A) via *K (so all the filter together) or indexing
    // each generator (i.e. data.*A).
    //
    // It seems reasonable to treat all generators in a 
    // contextual way, subject to a path filter. One could
    // try doing that in emitFilters. 

    let func = compile(q1)
    let res = func({ data3, udf: {guard: (x,y) => y }}, true)

    let expected = { 
      "A": [[110, 330], [120]],
      "B": [[200]],
    }
    let bug = { 
      "A": [[110, 330], [120], [110, 330]], // extra 110, 330 !!!
      "B": [[200]],
    }
    expect(res).toEqual(expected)
})


test("groupTestNested2_encoding2", () => {
    let q0 = {"data3.*A.key": { "*A": true }}

    let q1 = rh`udf.guard *K (array (udf.guard *B (
                        array (udf.guard ${q0}.*K.*C data3.*C.sub.*B))))`

    // Second encoding discussed above -- add a separate filter to
    // each *variable* rather than changing access paths
    // NOTE (1): have to use *C instead of default * to match
    // NOTE (2): have to use *K to iterate, can't just 
    //           use data3.*C.key (without the bugfix!!)

    let func = compile(q1)
    let res = func({ data3, udf: {guard: (x,y) => y }}, true)

    console.log(func.explain.pseudo)
    console.log(func.explain.code)

    let expected = { 
      "A": [[110, 330], [120]],
      "B": [[200]],
    }
    expect(res).toEqual(expected)
})


test("groupTestNested2_encoding3", () => {
    let q0 = rh`(mkset data3.*C.key)`

    let q1 = rh`udf.guard *K (array (udf.guard *B (
                        array (udf.guard ${q0}.*K data3.*C.sub.*B))))`

    let func = compile(q1)
    let res = func({ data3, udf: {guard: (x,y) => y }}, true)

    let expected = { 
      "A": [[110, 330], [120]],
      "B": [[200]],
    }
    expect(res).toEqual(expected)
})



// approach:
//  - group/update creates new filter *K <- mkset(data.*.key)
//  - internal stateful op picks up dependency on *K


test("gt1", () => {
    let q0 = {"data.*.key": "array data.*.value"}

    let func = compile(q0)
    let res = func({ data, udf: {guard: (x,y) => y }}, true)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      "A": [10,30],
      "B": [20],
    }
    expect(res).toEqual(expected)
})

test("gt2", () => {
    let q0 = {"data.*.key": "data.*.value"}

    let func = compile(q0)
    let res = func({ data, udf: {guard: (x,y) => y }}, true)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      0: {"A": 10 },
      1: {"B": 20 },
      2: {"A": 30 },
    }
    expect(res).toEqual(expected)
})

test("gt3", () => {
    let q0 = {foo: {"data.*.key": { bar: "sum data.*.value" }}}

    let func = compile(q0)
    let res = func({ data, udf: {guard: (x,y) => y }}, true)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      foo: {"A": { bar: 40 },
            "B": { bar: 20 }},
    }
    expect(res).toEqual(expected)
})

test("gt4", () => {
    let q0 = { foo: 1,//{"data.*.key": "sum data.*.value" },
               bar: 1}//{"data.*.key": "sum data.*.value" }}

    let func = compile(q0)
    let res = func({ data, udf: {guard: (x,y) => y }}, true)

    // console.log(func.explain.pseudo)
    // console.log(func.explain.code)

    let expected = { 
      // foo: {"A": 40, "B": 20},
      // bar: {"A": 40, "B": 20},
      foo: 1,
      bar: 1,
    }
    expect(res).toEqual(expected)
})




//  another case -- like advanced/nestedIterator1-explicitlyHoisted
//
//  this doesn't seem to be a bug, but just how things are.
//  however, encodings/hoisting need to operate accordingly.
//
//  TODO: investigate a transform that checks for every expression
//  if it is in the grouping path, and if yes, does not create
//  mind dependencies. 

test("groupTest_explicitHoisting", () => {
    let q0 = { "data.*.key": "array(data.*.key)" }

    let func = compile(q0)
    let res = func({ data }, true)

    let expected = { 
      "A": ["A"], // NOTE: two entries w/same key -> two results
      "B": ["B"]
    }

    let bug = { 
      "A": ["A", "A"], // NOTE: two entries w/same key -> two results
      "B": ["B"]
    }
    expect(res).toEqual(bug)
})

