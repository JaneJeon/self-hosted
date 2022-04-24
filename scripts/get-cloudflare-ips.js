#!/usr/bin/env node
import { got } from 'got'

// https://www.cloudflare.com/ips/
const promises = await Promise.all([
  got('https://www.cloudflare.com/ips-v4'),
  got('https://www.cloudflare.com/ips-v6')
])

const IPs = promises
  .map(result => result.body.split('\n').sort())
  .reduce((arr1, arr2) => [...arr1, ...arr2], [])

console.log(IPs.join(','))
