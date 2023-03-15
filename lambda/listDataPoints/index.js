const { DynamoDB } = require('aws-sdk')
var client = new DynamoDB.DocumentClient()

/**
 * Map graphQL key to query expresion
 *
 * @async
 * @param {{ for: string }} { for: key }
 * @returns {String}
 */
const mapKeyToExpr = ({ for: key }) => {
  switch (key) {
    case 'gt':
      return '#SK > :SK'
    case 'eq':
      return '#SK = :SK'
    case 'le':
      return '#SK <= :SK'
    case 'lt':
      return '#SK < :SK'
    case 'ge':
      return '#SK >= :SK'
    case 'between':
      return '#SK BETWEEN :SK0 AND :SK1'
    case 'beginsWith':
      return 'begins_with(#SK, :SK)'
    default:
      return ''
  }
}

/**
 * Prepare query params expression from graphql filter params
 *
 * @param {{ for: object }} { for: filter }
 * @returns {Object}
 */
const expr = ({ for: filter }) => {
  if (!filter) return {}
  const key = Object.keys(filter)[0]
  return {
    Names: { '#SK': 'SK' },
    Expr: mapKeyToExpr({ for: key }),
    Values:
      key !== 'between'
        ? { ':SK': filter[key] }
        : { ':SK0': filter[key][0], ':SK1': filter[key][1] },
  }
}

/**
 * Get listData lambda handler
 *
 * @async
 * @param {*} {
  with: {
      owner,
      name,
      createdAt,
      limit: Limit = 100,
      nextToken,
      sortDirection = 'ASC',
    },
  } query parameters for listDataPoints
 * @returns {*}
 */
const listDataPoints = async ({
  with: {
    owner,
    name,
    createdAt,
    limit: Limit = 100,
    nextToken,
    sortDirection = 'ASC',
  },
}) => {
  const p = expr({ for: createdAt })

  var ExclusiveStartKey = null
  try {
    ExclusiveStartKey = nextToken
      ? JSON.parse(Buffer.from(nextToken, 'base64'))
      : null
  } catch (error) {
    console.log('could not parse nextToken, fall back to none')
  }
  const params = {
    TableName: process.env.TABLE,
    ExpressionAttributeNames: { '#PK': 'PK', ...p.Names },
    ExpressionAttributeValues: { ':PK': `${owner}#${name}`, ...p.Values },
    KeyConditionExpression: `#PK = :PK` + (p.Expr ? ` AND ${p.Expr}` : ''),
    ScanIndexForward: sortDirection === 'ASC',
    Limit,
    ExclusiveStartKey,
  }

  console.log(JSON.stringify(params, null, 2))

  try {
    const results = await client.query(params).promise()
    console.log(results)
    const { Items: items, LastEvaluatedKey: last, ...rest } = results
    const lastString = JSON.stringify(last)
    const nextToken = last ? Buffer.from(lastString).toString('base64') : null
    return { items, nextToken, ...rest }
  } catch (error) {
    console.log(error)
    return null
  }
}

exports.handler = async (event) => {
  console.log('request:', JSON.stringify(event, undefined, 2))
  const { arguments: args, info } = event
  if (info.fieldName === 'listDataPoints') {
    return await listDataPoints({ with: args })
  }
  return null
}
