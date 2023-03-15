const cdk = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const AppsyncWorkshop = require('../lib/appsync-workshop-stack');


describe("Stack check", () => {
  let app, stack, template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new AppsyncWorkshop.AppsyncWorkshopStack(app, 'MyTestStack');
    template = Template.fromStack(stack);
  });

  test('check Lambda functions', () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Runtime: "nodejs14.x",
    });
  });

  test('check Cognito user pool ', () => {    
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "WorkshopUserPool"
    });
  });

  test('check counts of DynamoDB table ', () => {    
    template.resourceCountIs("AWS::DynamoDB::Table", 1);
  });

  test('check GraphQLApi', () => {
    template.hasResourceProperties("AWS::AppSync::GraphQLApi", {
      Name: "WorkshopAPI",
      AuthenticationType: "AMAZON_COGNITO_USER_POOLS"
    });
  });
});
