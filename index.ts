import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

// Criação do recurso de VPC
const vpc = new aws.ec2.Vpc('vpc', {
  cidrBlock: '10.0.0.0/16',
});

// Criando um internet gateway para a VPC
const igw = new aws.ec2.InternetGateway('my-igw', {
  vpcId: vpc.id,
});

// Criando uma subnet pública para a aplicação
const webSubnet1 = new aws.ec2.Subnet('web-subnet-1', {
  cidrBlock: '10.0.1.0/24',
  vpcId: vpc.id,
  mapPublicIpOnLaunch: true,
  availabilityZone: aws.getAvailabilityZones().then((zones) => zones.names[0]),
});

// Criando uma subnet pública para a aplicação
const webSubnet2 = new aws.ec2.Subnet('web-subnet-2', {
  cidrBlock: '10.0.2.0/24',
  vpcId: vpc.id,
  mapPublicIpOnLaunch: true,
  availabilityZone: aws.getAvailabilityZones().then((zones) => zones.names[1]),
});

// Criando uma tabela de roteamento para as subnets publicas ficarem acessíveis pelo internet gateway
const publicRouteTable = new aws.ec2.RouteTable('public-route-table', {
  vpcId: vpc.id,
  routes: [
    {
      cidrBlock: '0.0.0.0/0',
      gatewayId: igw.id,
    },
  ],
});

// Associando a tabela de roteamneto a primeira vpc publica
const publicRouteAssociation1 = new aws.ec2.RouteTableAssociation(
  'public-route-association-1',
  {
    routeTableId: publicRouteTable.id,
    subnetId: webSubnet1.id,
  },
);

// Associando a tabela de roteamneto a segunda vpc publica
const publicRouteAssociation2 = new aws.ec2.RouteTableAssociation(
  'public-route-association-2',
  {
    routeTableId: publicRouteTable.id,
    subnetId: webSubnet2.id,
  },
);

// Criando uma subnet privada para o banco de dados rds
const dbSubnet1 = new aws.ec2.Subnet('db-subnet-1', {
  cidrBlock: '10.0.3.0/24',
  vpcId: vpc.id,
  availabilityZone: aws.getAvailabilityZones().then((zones) => zones.names[0]),
});

// Criando uma subnet pública para o servidor web
const dbSubnet2 = new aws.ec2.Subnet('db-subnet-2', {
  cidrBlock: '10.0.4.0/24',
  vpcId: vpc.id,
  availabilityZone: aws.getAvailabilityZones().then((zones) => zones.names[1]),
});

// Criando um grupo de segurança para permitir o acesso HTTP
const webSg = new aws.ec2.SecurityGroup('web-sg', {
  vpcId: vpc.id,
  ingress: [
    { protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0'] },
  ],
});

// Criando um grupo de segurança para permitir o acesso aos dados
const dbSg = new aws.ec2.SecurityGroup('db-sg', {
  vpcId: vpc.id,
  ingress: [
    {
      protocol: 'tcp',
      fromPort: 3306,
      toPort: 3306,
      cidrBlocks: ['0.0.0.0/0'],
    },
  ],
});

const dbSubnetGroupName = 'my-db-group';

// Criando um grupo de subnets para associar ao banco
const dbSubnetGroup = new aws.rds.SubnetGroup('my-db-group', {
  name: dbSubnetGroupName,
  subnetIds: [dbSubnet1.id, dbSubnet2.id],
});

// Criando um banco de dados RDS
const db = new aws.rds.Instance(
  'my-db',
  {
    engine: 'mysql',
    instanceClass: 'db.t2.small',
    allocatedStorage: 10,
    dbSubnetGroupName,
    vpcSecurityGroupIds: [dbSg.id],
    username: 'admin',
    password: 'password',
    storageEncrypted: true,
    multiAz: true,
  },
  {
    dependsOn: dbSubnetGroup,
  },
);

// Criando um'a instância EC2 para o servidor web
const instance = new aws.ec2.Instance('my-instance', {
  instanceType: 't2.micro',
  ami: 'ami-00569e54da628d17c',
  vpcSecurityGroupIds: [webSg.id],
  subnetId: webSubnet1.id,
  userData: pulumi.interpolate`#!/bin/bash
      echo "Pulumi + AWS = <3" > index.html
      nohup python -m SimpleHTTPServer 80 &`,
});

// Criando um balanceador de carga
const lb = new aws.lb.LoadBalancer('my-lb', {
  internal: false,
  subnets: [webSubnet1.id, webSubnet2.id],
});

// Criando um target group para o baleaceador de carga
const targetGroup = new aws.lb.TargetGroup(
  'web-target',
  {
    port: 80,
    protocol: 'HTTP',
    vpcId: vpc.id,
    targetType: 'instance',
    healthCheck: {
      protocol: 'HTTP',
      port: '80',
      path: '/',
      timeout: 10,
      interval: 30,
      matcher: '200-299',
    },
  },
  {
    dependsOn: instance,
  },
);

// Criando um listener para o baleaceador de carga
const listener = new aws.lb.Listener('web-listener', {
  loadBalancerArn: lb.arn,
  port: 80,
  protocol: 'HTTP',
  defaultActions: [
    {
      type: 'forward',
      targetGroupArn: targetGroup.arn,
    },
  ],
});

// Anexando a instância ao target group para direcionar o trafego
const instanceTarget = new aws.lb.TargetGroupAttachment(
  'web-target-attachment',
  {
    targetGroupArn: targetGroup.arn,
    targetId: instance.id,
    port: 80,
  },
);

// Exportando informações sobre a aplicação
export const lbDnsName = lb.dnsName;
export const dbEndpoint = db.endpoint;
