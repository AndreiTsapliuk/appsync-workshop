// 1. Import dependencies
const cdk = require('aws-cdk-lib')
const appsync = require('@aws-cdk/aws-appsync-alpha')
const db = require('aws-cdk-lib/aws-dynamodb')
const cognito = require('aws-cdk-lib/aws-cognito')
const lambda = require('aws-cdk-lib/aws-lambda')

const { WafConfig } = require('./wafConfig')

//  Reintroduce: setup a static expiration date for the API KEY
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
const WORKSHOP_DATE = new Date() // date of this workshop
WORKSHOP_DATE.setHours(0)
WORKSHOP_DATE.setMinutes(0)
WORKSHOP_DATE.setSeconds(0)
WORKSHOP_DATE.setMilliseconds(0)
const KEY_EXPIRATION_DATE = new Date(WORKSHOP_DATE.getTime() + SEVEN_DAYS)


/**
 * Appsync workshop stack 
 * Included resources: AppSync, DynamoDB, Cognito (User pools), Lambda functions, WAF
 *
 * @class AppsyncWorkshopStack
 * @typedef {AppsyncWorkshopStack}
 * @extends {cdk.Stack}
 */
class AppsyncWorkshopStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props)

    // Configure the User Pool
    const pool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'WorkshopUserPool',
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true } },
    })
    // Configure the client from pool
    const client = pool.addClient('customer-app-client-web', {
      preventUserExistenceErrors: true,
    })

    // Define AppSync API
    const api = new appsync.GraphqlApi(this, 'WorkshopAPI', {
      name: 'WorkshopAPI',
      // Create schema using our schema definition
      schema: appsync.SchemaFile.fromAsset('appsync/schema.graphql'),
      // Add authorization & default authorization settings
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool: pool,
          },
        },
        // Add additional Authorization mode
        additionalAuthorizationModes: [
          {
            authorizationType: 'API_KEY',
            apiKeyConfig: {
              name: 'default',
              description: 'default auth mode',
              expires: cdk.Expiration.atDate(KEY_EXPIRATION_DATE),
            },
          },
        ],
      },
      // Configure logs settings
      xrayEnabled: true,
      logConfig: {
        excludeVerboseContent: false,
        fieldLogLevel: appsync.FieldLogLevel.ALL
      }
    })

    // Define the DynamoDB table with partition key and sort key
    const table = new db.Table(this, 'GenericDataPointTable', {
      partitionKey: { name: 'PK', type: db.AttributeType.STRING },
      sortKey: { name: 'SK', type: db.AttributeType.STRING },
    })

    // Define a Lambda function, passing the table name as an env variable
    const queryHandler = new lambda.Function(this, 'QueryDataHandler', {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset('lambda/listDataPoints'),
      handler: 'index.handler',
      environment: {
        TABLE: table.tableName,
      },
    })
    // Grant read policies to datasource for lambda function
    table.grantReadData(queryHandler)

    // Define a Lambda function with simple custom authorization using ALLOW env variable
    const customAuthorizer = new lambda.Function(this, 'CustomAuthorizer', {
      runtime: lambda.Runtime.NODEJS_14_X,
      code: lambda.Code.fromAsset('lambda/customAuthorizer'),
      handler: 'index.handler',
      environment: { ALLOW: 'true' },
    })

    // Set up table as a Datasource
    const dataSource = api.addDynamoDbDataSource('dataPointSource', table)

    // Define resolvers for AppSync
    dataSource.createResolver('QueryDataPointsByNameAndDateTimeResolver',{
      typeName: 'Query',
      fieldName: 'queryDataPointsByNameAndDateTime',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        'appsync/resolvers/Query.queryDataPointsByNameAndDateTime.req.vtl'
      ),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        'appsync/resolvers/Query.queryDataPointsByNameAndDateTime.res.vtl'
      ),
    })

    // Define for API dataSource as lambda function
    const lambdaSource = api.addLambdaDataSource(
      'lambdaQuerySource',
      queryHandler
    )

    const customAuthSource = api.addLambdaDataSource(
      'customAuthSource',
      customAuthorizer
    )

    // Create resolver for lambda query
    lambdaSource.createResolver('ListDataPoints',{
      typeName: 'Query',
      fieldName: 'listDataPoints',
    })

    // Define Auth pipeline function
    const pipelineAuthFn = new appsync.AppsyncFunction(this, 'f1', {
      api,
      name: 'userChecker',
      dataSource: customAuthSource,
      responseMappingTemplate: appsync.MappingTemplate.fromString(
        `#if(!$ctx.result.allow) $util.unauthorized() #end
        {}`
      ),
    })
    
    // Define Create DataPoint pipeline function
    const pipelineCreateDataPointFn = new appsync.AppsyncFunction(this, 'f2', {
      api,
      dataSource,
      name: 'createDataPoint',
      requestMappingTemplate: appsync.MappingTemplate.fromFile(
        'appsync/resolvers/Mutation.createDataPoint.req.vtl'
      ),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    })

    // Resolver for createDataPoint using pipelines
    const resolver = new appsync.Resolver(this, 'createDataPointPipeline', {
      api,
      typeName: 'Mutation',
      fieldName: 'createDataPoint',
      pipelineConfig: [pipelineAuthFn, pipelineCreateDataPointFn],
      requestMappingTemplate: appsync.MappingTemplate.fromString('{}'),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
    })
    
    
    // Define empty data source
    const none = api.addNoneDataSource('none')
    none.createResolver('OnCreateDataPoint',{
      typeName: 'Subscription',
      fieldName: 'onCreateDataPoint',
      requestMappingTemplate: appsync.MappingTemplate.fromString(`
      {
        "version": "2018-05-29",
        "payload": {}
      }`),
      responseMappingTemplate: appsync.MappingTemplate.fromFile(
        'appsync/resolvers/Subscription.onCreateDataPoint.res.vtl'
      ),
    })

    // Define WAF Resource
    const wafConfig = new WafConfig(this, 'WorkshopAPI-Waf', { api })

    // Stack Outputs
    new cdk.CfnOutput(this, 'GraphQLAPI_ID', { value: api.apiId })
    new cdk.CfnOutput(this, 'GraphQLAPI_URL', { value: api.graphqlUrl })
    new cdk.CfnOutput(this, 'GraphQLAPI_KEY', { value: api.apiKey })
    new cdk.CfnOutput(this, 'STACK_REGION', { value: this.region })
    // User Pool information
    new cdk.CfnOutput(this, 'USER_POOLS_ID', { value: pool.userPoolId })
    new cdk.CfnOutput(this, 'USER_POOLS_WEB_CLIENT_ID', {
      value: client.userPoolClientId,
    })
    // WAF information
    new cdk.CfnOutput(this, 'ACLRef', { value: wafConfig.acl.ref })
    new cdk.CfnOutput(this, 'ACLAPIAssoc', { value: wafConfig.association.ref })
  }
}

module.exports = { AppsyncWorkshopStack }
