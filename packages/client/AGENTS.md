# @hollware/client

The typed Hollware client. Boundary rules for this package:

- One typed interface over two transports, a service binding and HTTP: the caller picks a
  transport, never a different API.
- Never read `process.env`: the binding, or the URL and token, arrive as arguments.
